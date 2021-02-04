import express from 'express';
import bodyParser from 'body-parser';
import low from 'lowdb';
import FileSync from 'lowdb/adapters/FileSync';
import lodashId from 'lodash-id';
import cors from 'cors';
import axios from 'axios';

const YUBI_PAYMENTS_BASE = 'http://localhost:3000/payments/partner';
const YUBI_PARTNER_BACKEND = 'http://localhost:3030';
const YUBI_API_KEY = 'supersafekey';

type Janken = 'rock' | 'paper' | 'scissors';

async function main() {
  const app = express();
  const port = 3000;
  const db = createDatabase();

  //middleware
  app.use(bodyParser.json());
  app.use(cors());

  app.get('/', (_req, _res) => {
    // const post = db.get('posts').find({ id: 1 }).value();
    // res.json(post);
  });

  app.post('/login', (req, res) => {
    const { username } = req.body;
    const user = db.get('users').find({ username: username }).value();
    res.json(user);
  });

  app.post('/create-link', (req, res) => {
    const { userId, currency } = req.body;
    const metadata = 'janken-game';
    const resp = {
      yubiLink: `${YUBI_PAYMENTS_BASE}?correlation=${userId}&currency=${currency}&metadata=${metadata}`,
    };
    res.json(resp);
  });

  app.post('/withdraw', (req, res) => {
    const { userId, currency, value } = req.body;
    const metadata = 'janken-game';
    // const resp = {
    //   yubiLink: `${YUBI_PAYMENTS_BASE}?correlation=${userId}&currency=${currency}&metadata=${metadata}`,
    // };
    // res.json(resp);
    res.sendStatus(200);
  });

  app.post('/janken', (req, res) => {
    const { move } = req.body;
    if (move !== 'rock' || move !== 'paper' || move !== 'scissors') {
      console.log(`invalid move: ${move}`);
    }
    console.log(req.body);
    res.json(req.body);
  });

  app.listen(port, () => {
    console.log(`app listening at http://localhost:${port}`);
  });

  stateUpdateLoop(db);
}

main()
  .then((_res) => {})
  .catch(console.error);

function createDatabase() {
  const adapter = new FileSync('dist/db.json');
  const db = low(adapter);
  db._.mixin(lodashId);

  db.defaults({ users: [] }).write();
  db.get('posts').push({ id: 1, title: 'lowdb is awesome' }).write();

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
