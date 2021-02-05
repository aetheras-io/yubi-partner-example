import {
  JSONParse,
  IsPlayResponse,
  IsLoginResponse,
  LoginResponse,
  PlayResponse,
  JankenMove,
  UserTuple,
} from './types';

const GAME_API = 'http://localhost:3001';

export async function login(userId: string): Promise<LoginResponse> {
  const resp = await fetch(`${GAME_API}/login`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ userId }),
  });

  if (!resp.ok) {
    throw Error(`login failed: `);
  }

  const payload = await resp.text();
  console.log('login', payload);
  const result = JSONParse(IsLoginResponse)(payload);
  switch (result.type) {
    case 'Ok':
      return result.value;
    case 'Err':
      throw result.error;
  }
}

export async function getAllUsers(): Promise<Array<UserTuple>> {
  const resp = await fetch(`${GAME_API}/allUsers`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
  });

  if (!resp.ok) {
    throw Error(`getAllUsers failed: `);
  }

  return await resp.json();
}

export async function janken(move: JankenMove): Promise<PlayResponse> {
  const resp = await fetch(`${GAME_API}/janken`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ move }),
  });

  if (!resp.ok) {
    throw Error(`playJanken failed: `);
  }

  const payload = await resp.text();
  const result = JSONParse(IsPlayResponse)(payload);
  switch (result.type) {
    case 'Ok':
      return result.value;
    case 'Err':
      throw result.error;
  }
}

export async function withdraw(
  userId: string,
  currency: string,
  value: number
) {
  const resp = await fetch(`${GAME_API}/withdraw`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ userId, currency, value }),
  });

  if (!resp.ok) {
    throw Error(`playJanken failed: `);
  }
}
