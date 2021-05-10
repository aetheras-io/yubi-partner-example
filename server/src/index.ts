import express from 'express';
import crypto from 'crypto';
import { Keccak } from 'sha3';
import bodyParser from 'body-parser';
import low from 'lowdb';
import fs from 'fs';
import FileSync from 'lowdb/adapters/FileSync';
import lodashId from 'lodash-id';
import cors from 'cors';
import axios from 'axios';
import { UserState, JankenMove, JankenResult } from './types';
import mkdirp from 'mkdirp';
import { v4 as uuidv4 } from 'uuid';
import { URLSearchParams } from 'url';

const RSA_PRIVATE_KEY = fs.readFileSync('./private.pem');
const RSA_PUBLIC_KEY = fs.readFileSync('./public.pem');

// Aggregate Configuration Variables
const PARTNER_PLATFORM = 'ABC Corp. Ltd';
const PORT = process.env.PORT ? process.env.PORT : 3001;
const YUBI_PARTNER_ID = process.env.PARTNER_ID
  ? process.env.PARTNER_ID
  : '10101';
const YUBI_HOST = process.env.YUBI_HOST
  ? process.env.YUBI_HOST
  : 'http://localhost:3000';
const YUBI_API = process.env.YUBI_API
  ? process.env.YUBI_API
  : 'http://localhost:3030';
const YUBI_PAYMENTS_URL = `${YUBI_HOST}/payments/partner`;

console.log(`
===CONFIG===
Port: ${PORT}
Partner: ${PARTNER_PLATFORM}
Yubi PartnerID: ${YUBI_PARTNER_ID}
Yubi Api: ${YUBI_API}
Yubi Payments URL: ${YUBI_PAYMENTS_URL}
===========\n`);

const httpClient = axios.create({
  baseURL: 'http://localhost:3030',
});

async function main() {
  const payload = Buffer.from(JSON.stringify({ hello: 'world' }), 'utf8');
  console.log(`payload base64: ${payload.toString('base64')}`);
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(payload.toString('base64'));
  const signature = signer.sign(RSA_PRIVATE_KEY, 'base64');

  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(payload.toString('base64'));
  let result = verifier.verify(RSA_PUBLIC_KEY, signature, 'base64');
  console.log('RESULT: ', result);

  // const signer = crypto.createSign('RSA-SHA256');
  // const verifier = crypto.createVerify('RSA-SHA256');
  // signer.update('hello world');
  // let sig = signer.sign(RSA_PRIVATE_KEY, 'base64');
  // console.log(`hello world signature: ${sig}`);

  // verifier.update('hello world');
  // let result = verifier.verify(RSA_PUBLIC_KEY, sig, 'base64');
  // console.log(`verify res: ${result}`);

  const app = express();
  const port = PORT;
  const db = await createDatabase();
  await recover(db);

  //middleware
  app.use(bodyParser.json());
  app.use(cors());

  // Mock Login
  app.post('/login', (req, res) => {
    const { userId } = req.body;
    const user = db.get('users').getById(userId).value();
    res.json(user);
  });

  // Query users
  app.get('/allUsers', (_req, res) => {
    const users = db
      .get('users')
      .value()
      .map((u: UserState) => ({ username: u.username, id: u.id }));
    res.json(users);
  });

  // Withdraw funds to YUBI as User
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
    if (!user.yubiAccount) {
      res.status(400).send('no withdrawal account available');
      return;
    }
    if (currency !== 'Tether') {
      res.status(400).send('unsupported currency');
      return;
    }

    const idempotencyKey = uuidv4();
    const request = {
      id: idempotencyKey,
      userId,
      yubiRequestId: undefined,
      url: `${YUBI_API}/partners/userWithdrawal`,
      params: {
        user: user.yubiAccount,
        amount: {
          kind: currency,
          value: String(value),
        },
        idempotencyKey,
        metadata: jankenMetadata(userId),
      },
    };

    let accepted = await idempotentWithdrawal(db, request);
    if (!accepted) {
      res.sendStatus(500);
    } else {
      res.sendStatus(202);
    }
  });

  // Play Janken as User
  app.post('/janken', (req, res) => {
    const wager = 10;
    const selections: Array<JankenMove> = ['rock', 'paper', 'scissors'];
    const { userId, move } = req.body;
    if (move !== 'rock' && move !== 'paper' && move !== 'scissors') {
      res.status(500).send('invalid move');
      return;
    }

    const collection = db.get('users');
    const txCollection = db.get('tetherTransactions').value();
    const user = collection.getById(userId).value();
    const cpuMove: JankenMove =
      selections[Math.floor(Math.random() * selections.length)];

    if (user.balance < wager) {
      res.status(500).send('insufficient funds');
      return;
    }

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
      txCollection.push({
        userId: user.id,
        kind: 'Win(Janken)',
        amount: { kind: 'Tether', value: String(wager) },
        at: new Date().toString(),
      });
    } else {
      result = 'lose';
      user.balance -= wager;
      txCollection.push({
        userId: user.id,
        kind: 'Loss(Janken)',
        amount: { kind: 'Tether', value: String(wager) },
        at: new Date().toString(),
      });
    }

    db.write();

    res.json({
      remoteMove: cpuMove,
      result: result,
      userState: user,
      value: wager,
    });
  });

  // Get the YUBI Deposit link
  app.post('/depositLink', (req, res) => {
    const { userId } = req.body;
    const user = db.get('users').getById(userId).value();
    if (!user) {
      res.status(400).send('unknown user');
      return;
    }

    res.json(createYubiPaymentLink(userId, 'Tether'));
  });

  // Get list of User's Transactions
  app.post('/transactions', (req, res) => {
    const { userId } = req.body;
    const txns = db.get('tetherTransactions').filter({ userId }).value();
    res.json(txns);
  });

  // Get Full Database State Dump
  app.get('/state', (_req, res) => {
    res.header('Content-Type', 'application/json');
    res.send(JSON.stringify(db, null, 4));
  });

  // Check API Server Liveliness
  app.get('/healthz', (_req, res) => {
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
  const requestCache: Array<WalletWithdrawRequest> = db
    .get('requestCache')
    .filter({ yubiRequestId: undefined })
    .value();

  for (var i = 0; i < requestCache.length; i++) {
    console.log(`recovering request: ${requestCache[i]}`);
    const ok = await idempotentWithdrawal(db, requestCache[i]);
    if (!ok) {
      console.log(
        `idempotent withdrawal recovery failed:`,
        JSON.stringify(requestCache[i])
      );
    }
  }
}

type WalletWithdrawRequest = {
  id: string;
  userId: string;
  url: string;
  yubiRequestId: string | undefined;
  params: {
    user: string;
    amount: {
      kind: string;
      value: string;
    };
    idempotencyKey: string;
    metadata: any;
  };
};

// Yubi API guarantees a request remains idempotent for 24 hours if the same idempotency key
// is given for a request
async function idempotentWithdrawal(db, request: WalletWithdrawRequest) {
  const user = db.get('users').getById(request.userId).value();
  const requestCache = db.get('requestCache');

  // #IMPORTANT, User.balance and idempotent requests object must be a transactional write in YOUR
  // database.  `user.balance -= value`` and the request is stored on disk after the `write()` call
  const value = Number(request.params.amount.value);
  console.log('user balance pre withdraw:', user.balance);
  user.balance -= value;
  console.log('user balance post withdraw:', user.balance);
  const cachedRequest = requestCache.insert(request).write();

  //Post Request, retrying if we can
  const yubiRequestId = await retryRequest(request);
  if (yubiRequestId) {
    //store the withdrawal response id from YUBI
    //when the corresponding event comes back from YUBI, we can mark the entry based on the
    //yubi request id.  This lets us know for sure if a response was received
    console.log(yubiRequestId);
    cachedRequest.yubiRequestId = yubiRequestId;
    requestCache.write();
  } else {
    // #IMPORTANT the balance update and requestCache item must be removed together in
    // a transaction!
    user.balance += value;
    requestCache.removeById(request.id).write();
  }

  return true;
}

//type DirectWithdrawRequest = {
//  id: string;
//  userId: string;
//  url: string;
//  yubiRequestId: string | undefined;
//  params: {
//    amount: {
//      kind: string;
//      value: string;
//    };
//    idempotencyKey: string;
//    metadata: any;
//  };
//};

//// Yubi API guarantees a request remains idempotent for 24 hours if the same idempotency key
//// is given for a request
//async function idempotentDirectWithdrawal(db, request: WalletWithdrawRequest) {
//  const user = db.get('users').getById(request.userId).value();
//  const requestCache = db.get('requestCache');

//  // #IMPORTANT, User.balance and idempotent requests object must be a transactional write in YOUR
//  // database.  `user.balance -= value`` and the request is stored on disk after the `write()` call
//  const value = Number(request.params.amount.value);
//  console.log('user balance pre withdraw:', user.balance);
//  user.balance -= value;
//  console.log('user balance post withdraw:', user.balance);
//  const cachedRequest = requestCache.insert(request).write();

//  //Post Request, retrying if we can
//  const yubiRequestId = await retryRequest(request);
//  if (yubiRequestId) {
//    //store the withdrawal response id from YUBI
//    //when the corresponding event comes back from YUBI, we can mark the entry based on the
//    //yubi request id.  This lets us know for sure if a response was received
//    console.log(yubiRequestId);
//    cachedRequest.yubiRequestId = yubiRequestId;
//    requestCache.write();
//  } else {
//    // #IMPORTANT the balance update and requestCache item must be removed together in
//    // a transaction!
//    user.balance += value;
//    requestCache.removeById(request.id).write();
//  }

//  return true;
//}

async function retryRequest(request): Promise<string | undefined> {
  let retries = 5;
  while (retries > 0) {
    console.log(
      `idempotent request: ${request.url} params: ${JSON.stringify(
        request.params,
        null,
        2
      )}`
    );
    try {
      let resp = await httpClient.post(request.url, request.params, {
        headers: { 'Idempotency-Key': request.id },
      });
      if (resp.status === 202) {
        return resp.data.processId;
      }
    } catch (e) {
      if (e.response) {
        console.log(request);
        // request failed due to bad request or server error.  Abort
        console.log(
          'Idempotent Bad Request, removing cached request and refunding user:',
          request.Id
        );
        return undefined;
      } else if (e.request) {
        // request failed due to timeout.  Could be our network or remote's network or both.
        // it is possible the request arrived or did not arrive, this is retryable
        console.log('Idempotent Timed Out, retrying:', e.request);
        console.log(e.response);
      } else {
        // this is code level errors like null objects.  In this case, it should be a bad request
        console.log('Idempotent Request Error:', request.Id);
        return undefined;
      }
    }
  }

  // be friendly to the remote api
  await delay(1000);
  retries -= 1;
  return undefined;
}

export function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jankenMetadata(userId: string) {
  return {
    userId,
    gameType: 'janken',
    platform: PARTNER_PLATFORM,
    time: Date.now().toString(),
  };
}

function createYubiPaymentLink(userId: string, currency: string): string {
  const metadataURIParams = new URLSearchParams(jankenMetadata(userId));
  return `${YUBI_PAYMENTS_URL}?currency=${currency}&partner=${YUBI_PARTNER_ID}&${metadataURIParams.toString()}`;
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

    db.defaults({
      initialized: true,
      yubiCheckpoint: {
        eventIndex: '0',
      },
      users: [],
      requestCache: [],
      tetherTransactions: [],
    }).write();

    const usersCollection = db.get('users');
    usersCollection
      .insert({
        id: '0ee12dff-a026-4fa1-b67a-9f97da73aba4',
        username: 'Goku',
        balance: 0,
        yubiAccount: undefined,
      })
      .write();
    usersCollection
      .insert({
        id: 'ea706f4f-3bfc-4953-95d3-170dd562bf2e',
        username: 'Yusuke',
        balance: 0,
        yubiAccount: undefined,
      })
      .write();
    usersCollection
      .insert({
        id: '10cc7c5-813d-461e-a063-3c5acec61bae',
        username: 'Gon',
        balance: 0,
        yubiAccount: undefined,
      })
      .write();
    usersCollection
      .insert({
        id: '617ac13f-4543-4a29-9cef-856d2611b967',
        username: 'Naruto',
        balance: 0,
        yubiAccount: undefined,
      })
      .write();
  }

  return db;
}

function stateUpdateLoop(db) {
  const checkpoint = db.get('yubiCheckpoint').value();
  const usersCollection = db.get('users');
  const txCollection = db.get('tetherTransactions').value();
  const requestCache = db.get('requestCache');

  let loopId = setInterval(async () => {
    let data = await query_events(checkpoint.eventIndex);
    if (!data) {
      return;
    }

    try {
      // console.log(`received ${resp.data.length} events`);
      for (var i = 0; i < data.length; i++) {
        const event = data[i];
        const user = usersCollection.getById(event.metadata.userId).value();
        console.log(`processing ${event.kind} event`);
        switch (event.kind) {
          case 'Received':
            // process each event and store the fact
            user.balance += Number(event.amount.value);
            user.yubiAccount = event.correlationId;
            txCollection.push({
              userId: user.id,
              kind: 'Deposit',
              amount: event.amount,
              at: event.when,
            });
            break;
          case 'Transfered':
            // It is up to the system to decide if the requestCache for this transfer event
            // should be deleted
            txCollection.push({
              userId: user.id,
              kind: 'Withdraw',
              amount: event.amount,
              at: event.when,
            });
            break;
        }
        //#NOTE this bigint conversion is needed only because javascript only uses 53bit precision
        //for numbers and the api uses i64 for event indices
        let index = BigInt(checkpoint.eventIndex);
        index += BigInt(1);
        checkpoint.eventIndex = index.toString();
        // the last write makes everything transactional
        db.write();
      }
    } catch (e) {
      console.log(`server logic error: ${e}`);
      clearInterval(loopId);
      throw e;
    }
  }, 5000);
}

type EventsRequest = {
  currencyKind: string;
  version: string;
};

type SignedRequest = {
  id: string;
  signature: string;
  payload: string;
};

function createSignedRequest(
  id: string,
  request: object,
  privateKey: any
): SignedRequest {
  // get the JSON bytes of the request as base64 string
  const payload = Buffer.from(JSON.stringify(request), 'utf8').toString(
    'base64'
  );

  // keccak256 hash the base64 payload, since RSA signature message can only be 222 bytes long
  const hasher = new Keccak(256);
  hasher.update(payload);
  const output = hasher.digest();

  // sign the keccak256 hash as a base64 signature
  const signer = crypto.createSign('RSA-SHA256');
  const signature = signer.update(output).sign(privateKey, 'base64');
  return { id, signature, payload };
}

async function query_events(eventIndex: string): Promise<any> {
  try {
    console.log('requesting events from:', eventIndex);
    const request: EventsRequest = {
      currencyKind: 'Tether',
      version: eventIndex,
    };
    const signedRequest = createSignedRequest(
      YUBI_PARTNER_ID,
      request,
      RSA_PRIVATE_KEY
    );

    const resp = await httpClient.post(
      `${YUBI_API}/partners/events`,
      signedRequest
    );
    if (resp.status !== 200) {
      console.log(`events query failed with status: ${resp.status}`);
      return;
    }
    return resp.data;
  } catch (e) {
    console.log(`update failed: ${e}`);
    return;
  }
}

// const request_uri = `/partners/events?partnerId=${YUBI_PARTNER_ID}&currencyKind=Tether&version=${eventIndex}`;
// const signer = crypto.createSign('RSA-SHA256');
// signer.update(request_uri);
// const signature = signer.sign(RSA_PRIVATE_KEY, 'base64');
// const signed_request = `${request_uri}&sig=${signature}`;
// console.log(`signed request uri: ${signed_request}`);
