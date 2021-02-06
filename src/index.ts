import express from 'express';
import bodyParser from 'body-parser';
import low from 'lowdb';
import FileSync from 'lowdb/adapters/FileSync';
import lodashId from 'lodash-id';
import cors from 'cors';
import axios from 'axios';
import { UserState, JankenMove, JankenResult } from './types';
import mkdirp from 'mkdirp';

const YUBI_PAYMENTS_BASE = 'http://localhost:3000/payments/partner';
const YUBI_PARTNER_BACKEND = 'http://localhost:3030';
const YUBI_API_KEY = 'supersafekey';
const YUBI_PARTNER_ID = 'uuid_newv4';

async function main() {
  const app = express();
  const port = 3001;
  const db = await createDatabase();

  //middleware
  app.use(bodyParser.json());
  app.use(cors());

  app.get('/', (_req, _res) => {
    // const post = db.get('posts').find({ id: 1 }).value();
    // res.json(post);
  });

  app.post('/login', (req, res) => {
    const { userId } = req.body;
    const user = db.get('users').getById(userId).value();
    res.json({
      user,
      yubiLink: createYubiPaymentLink(user.id, 'USDT'),
    });
  });

  app.get('/allUsers', (_req, res) => {
    const users = db
      .get('users')
      .value()
      .map((u: UserState) => ({ username: u.username, id: u.id }));
    res.json(users);
  });

  //app.post('/withdraw', (req, res) => {
  //  const { userId, currency, value } = req.body;
  //  const metadata = {
  //    gameType: 'janken',
  //  };
  //  //use idempotent api call to yubi
  //  res.sendStatus(200);
  //});

  const wager = 10;
  const selections: Array<JankenMove> = ['rock', 'paper', 'scissors'];
  app.post('/janken', (req, res) => {
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

    collection.upsert(user);
    console.log(user);
    res.json({
      remoteMove: cpuMove,
      result: result,
      userState: user,
      value: wager,
    });
  });

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

// This can be created on the front end but it is easier to make changes
// if the URL is created on the server side
function createYubiPaymentLink(userId: string, currency: string): string {
  const metadata = {
    gameType: 'janken',
    platform: 'PlatformABC',
    time: new Date().getTime(),
  };
  const metadataURI = encodeMetadataToKV(metadata);
  return `${YUBI_PAYMENTS_BASE}?correlation=${userId}&currency=${currency}&partner=${YUBI_PARTNER_ID}&${metadataURI}}`;
}

function encodeMetadataToKV(o: object) {
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
    usersCollection.insert({ username: 'Yusuke', balance: 1000 }).write();
    usersCollection.insert({ username: 'Gon', balance: 1000 }).write();
    usersCollection.insert({ username: 'Naruto', balance: 1000 }).write();
  }

  return db;
}

function stateUpdateLoop(_db) {
  const client = axios.create({
    baseURL: 'http://localhost:3030',
    headers: {
      'X-API-KEY': YUBI_API_KEY,
    },
  });
  // setInterval(async () => {
  //   let res = await client.get('');
  //   console.log(res);
  // }, 5000);
}
