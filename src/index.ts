import express from 'express';
import bodyParser from 'body-parser';
import low from 'lowdb';
import FileSync from 'lowdb/adapters/FileSync';
import lodashId from 'lodash-id';
import cors from 'cors';
import axios from 'axios';
import { UserState, JankenMove, JankenResult } from './types';
import mkdirp from 'mkdirp';
import { v4 as uuidv4 } from 'uuid';

const PLATFORM = 'ABC Corp. Ltd';
const YUBI_PAYMENTS_BASE = 'http://localhost:3000/payments/partner';
const YUBI_PARTNER_BACKEND = 'http://tonywu:3030';
const YUBI_API_KEY = 'supersafekey';
const YUBI_PARTNER_ID = '809cf0ea-6be4-41b6-ab63-2207faf2e253';

const httpClient = axios.create({
  baseURL: 'http://localhost:3030',
  headers: {
    'X-API-KEY': YUBI_API_KEY,
  },
});

async function main() {
  const app = express();
  const port = 3001;
  const db = await createDatabase();

  //middleware
  app.use(bodyParser.json());
  app.use(cors());

  app.post('/login', (req, res) => {
    const { userId } = req.body;
    const user = db.get('users').getById(userId).value();
    res.json(user);
  });

  app.get('/allUsers', (_req, res) => {
    const users = db
      .get('users')
      .value()
      .map((u: UserState) => ({ username: u.username, id: u.id }));
    res.json(users);
  });

  app.post('/withdraw', async (req, res) => {
    const { userId, currency, value } = req.body;
    const userCollection = db.get('users');
    let user = userCollection.getById(userId).value();
    if (!user) {
      res.status(400).send('unknown user');
      return;
    }
    if (user.balance < value) {
      res.status(400).send('insufficient funds');
      return;
    }
    if (currency !== 'USDT') {
      res.status(400).send('unsupported currency');
      return;
    }

    const params = {
      currency,
      value,
      metadata: jankenMetadata(userId),
    };

    async function idReq(db, yubiAccount, currency, value, metadata) {
      const user = userCollection.getById(userId).value();
      const idempotency_key = uuidv4();
      const params = {
        yubiAccount,
        currency,
        value,
        metadata,
      };

      // deduct user funds
      console.log(`${user.username} withdrawal balance pre: ${user.balance}`);
      user.balance -= value;
      console.log(`${user.username} withdrawal balance after: ${user.balance}`);
      const txCollection = db.get('pendingTx');
      const tx = txCollection
        .insert({
          id: idempotency_key,
          url: `${YUBI_PARTNER_BACKEND}/partners/userWithdrawal`,
          params,
        })
        .write();
      // IMPORTANT, User.balance and new txCollection item must be a transactional write in the
      // database.  Lowdb is awkward, because `user.balance -= value`` doesn't get stored on disk until the `txCollection.write()` call
    }

    let accepted = await idempotentRequest(tx, txCollection);

    if (!accepted) {
      user.balance += value;
      console.log(
        `${user.username} withdrawal balance refund: ${user.balance}`
      );
      await userCollection.write();
      res.sendStatus(500);
    } else {
      res.sendStatus(202);
    }
  });

  const wager = 10;
  const selections: Array<JankenMove> = ['rock', 'paper', 'scissors'];
  app.post('/janken', async (req, res) => {
    const { userId, move } = req.body;
    if (move !== 'rock' && move !== 'paper' && move !== 'scissors') {
      console.log(`invalid move: ${move}`);
    }
    const collection = db.get('users');
    const user = collection.getById(userId).value();
    const cpuMove: JankenMove =
      selections[Math.floor(Math.random() * selections.length)];

    let result: JankenResult;
    if (move === cpuMove) {
      result = 'draw';
    } else if (
      (move === 'rock' && cpuMove === 'scissors') ||
      (move === 'scissors' && cpuMove === 'paper') ||
      (move === 'paper' && cpuMove === 'rock')
    ) {
      result = 'win';
      user.balance += wager;
    } else {
      result = 'lose';
      user.balance -= wager;
    }

    await collection.write();
    console.log(user);
    res.json({
      remoteMove: cpuMove,
      result: result,
      userState: user,
      value: wager,
    });
  });

  app.post('/depositLink', async (req, res) => {
    const { userId } = req.body;
    const collection = db.get('users');
    let user = collection.getById(userId).value();
    if (!user) {
      res.status(400).send('unknown user');
      return;
    }

    console.log(createYubiPaymentLink(userId, 'USDT'));
    res.json(createYubiPaymentLink(userId, 'USDT'));
  });

  app.get('/healthz', (_req, res) => {
    res.sendStatus(200);
  });

  app.get('/tx', (_req, res) => {
    let user = db.get('users[0]').value();
    user.balance += 100;
    db.get('pendingTx').insert({ test: 'hello' }).write();

    res.sendStatus(200);
  });

  app.listen(port, () => {
    console.log(`app listening at http://localhost:${port}`);
  });

  stateUpdateLoop(db);
}

main()
  .then((_res) => {})
  .catch(console.error);

async function recover(db) {
  const users = db.get('users');
  const pendingTxs = db.get('pendingTx').filter({ txId: null }).value();
  console.log(pendingTxs);
  // for (var tx in pendingTxs) {
  //   const accepted = await idempotentRequest(db, tx.url, tx.params);
  //   if (!accepted) {
  //     // this was a bad request but we crashed before we could react, need to undo the debit
  //     const user = users.getById(params.correlationId);
  //     user.balance += tx.params.value;
  //   }
  // }
}

// Yubi API guarantees a request remains idempotent for 24 hours if the same idempotency key
// is given for a request
async function idempotentWithdrawal(db): Promise<boolean> {
  let retries = 5;
  while (retries > 0) {
    console.log(`idempotent request: ${tx.url} ---- ${tx.params}`);
    try {
      let resp = await httpClient.post(tx.url, tx.params, {
        headers: { 'Idempotency-Key': tx.id },
      });
      if (resp.status === 202) {
        //store the withdrawal response id from YUBI
        //when the corresponding event comes back from YUBI, we can delete the entry based on the
        //transaciton id
        tx.yubiRequestId = resp.data.id;
        await collection.write();
        return true;
      }
    } catch (e) {
      if (e.response) {
        // request failed due to bad request or server error.  Abort
        console.log('Idempotent Bad Request, removing pending:', tx.Id);
        await collection.removeById(tx.Id).write();
        return false;
      } else if (e.request) {
        console.log('Idempotent Timed Out, retrying:', tx.Id);
        // request failed due to timeout.  Could be our network or remote's network or both.
        // it is possible the request arrived or did not arrive, this is retryable
      } else {
        console.log('Idempotent Request Error:', tx.Id);
        // this is code level errors like null objects.  In this case, it should be a bad request
        return false;
      }
    }

    // we errored
    retries -= 1;

    // be friendly to the remote api
    await delay(1000);
  }
  return false;
}

export function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jankenMetadata(userId: string) {
  return {
    userId,
    gameType: 'janken',
    platform: PLATFORM,
    time: new Date().getTime(),
  };
}

// This can be created on the front end but it is easier to make changes
// if the URL is created on the server side
function createYubiPaymentLink(userId: string, currency: string): string {
  const metadataURI = encodeObjectKV(jankenMetadata(userId));
  return `${YUBI_PAYMENTS_BASE}?currency=${currency}&partner=${YUBI_PARTNER_ID}&${metadataURI}`;
}

function encodeObjectKV(o: object) {
  const str: Array<string> = [];
  for (var key in o) {
    if (o.hasOwnProperty(key)) {
      const value = o[key];
      str.push(encodeURIComponent(key) + '=' + encodeURIComponent(value));
    }
  }
  return str.join('&');
}

async function createDatabase() {
  try {
    await mkdirp('dist');
  } catch (e) {
    console.error('mkdirp error:', e);
    throw e;
  }

  const adapter = new FileSync('dist/db.json');
  const db = low(adapter);
  db._.mixin(lodashId);

  if (!db.get('initialized').value()) {
    console.log('initializing blank database');

    db.defaults({ initialized: true, users: [], pendingTx: [] }).write();

    const usersCollection = db.get('users');
    usersCollection.insert({ username: 'Goku', balance: 1000 }).write();
    // usersCollection.insert({ username: 'Yusuke', balance: 1000 }).write();
    // usersCollection.insert({ username: 'Gon', balance: 1000 }).write();
    // usersCollection.insert({ username: 'Naruto', balance: 1000 }).write();
  }

  return db;
}

function stateUpdateLoop(_db) {
  // setInterval(async () => {
  //   let res = await client.get('');
  //   console.log(res);
  // }, 5000);
}
