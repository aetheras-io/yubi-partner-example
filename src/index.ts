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

    let accepted = await idempotentWithdrawal(
      db,
      userId,
      'some-thing',
      'USDT',
      50,
      jankenMetadata(userId)
    );

    if (!accepted) {
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
    const users = db.get('users');
    const requestCache = db.get('requestCache').value();
    console.log(requestCache);

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

// In case of a crash, we get all of the requests without a requestId (due to missing the response
// from the Yubi API server) and retry the request until we receive a 202 accepted
async function recover(db) {
  const requestCache = db
    .get('requestCache')
    .filter({ requestId: undefined })
    .value();

  for (var tx in requestCache) {
    const accepted = await retryRequest(db, tx);
    if (!accepted) {
      console.log('tx');
    }
  }
  console.log(requestCache);
}

// Yubi API guarantees a request remains idempotent for 24 hours if the same idempotency key
// is given for a request
async function idempotentWithdrawal(
  db,
  userId: string,
  yubiAccount: string,
  currency: string,
  value: number,
  metadata: any
) {
  const user = db.get('users').getById(userId).value();
  const requestCache = db.get('requestCache');
  const idempotency_key = uuidv4();
  const params = {
    yubiAccount,
    currency,
    value,
    metadata,
  };

  // IMPORTANT, User.balance and idempotent requests item must be a transactional write in the
  // database.  Lowdb is awkward, because `user.balance -= value`` doesn't get stored on disk
  // until the last `write()` call
  user.balance -= value;
  const tx = requestCache
    .insert({
      id: idempotency_key,
      url: `${YUBI_PARTNER_BACKEND}/partners/userWithdrawal`,
      params,
    })
    .write();

  return retryRequest(db, tx);
}

async function retryRequest(db, tx): Promise<boolean> {
  const requestCache = db.get('requestCache');

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
        // yubi request id.  This lets us know for sure if a response was received
        tx.yubiRequestId = resp.data.id;
        await requestCache.write();
        return true;
      }
    } catch (e) {
      if (e.response) {
        // request failed due to bad request or server error.  Abort
        console.log(
          'Idempotent Bad Request, removing cached tx and refunding user:',
          tx.Id
        );
        // #IMPORTANT the balance update and requestCache item must be removed together in
        // transaction!
        let user = db.get('users').getById(tx.params.userId);
        user.balance += tx.value;
        await requestCache.removeById(tx.Id).write();
        return false;
      } else if (e.request) {
        // request failed due to timeout.  Could be our network or remote's network or both.
        // it is possible the request arrived or did not arrive, this is retryable
        console.log('Idempotent Timed Out, retrying:', e.request);
        console.log(e.response);
      } else {
        // this is code level errors like null objects.  In this case, it should be a bad request
        console.log('Idempotent Request Error:', tx.Id);
        let user = db.get('users').getById(tx.params.userId);
        user.balance += tx.value;
        await requestCache.removeById(tx.Id).write();
        return false;
      }
    }
  }

  // be friendly to the remote api
  await delay(1000);
  retries -= 1;
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

    db.defaults({ initialized: true, users: [], requestCache: [] }).write();

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
