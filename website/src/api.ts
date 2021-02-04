import {
  JSONParse,
  IsPlayResponse,
  IsUserState,
  IsPaymentLinkResponse,
  UserState,
  PlayResponse,
  JankenMove,
} from './types';

const GAME_API = 'http://localhost:3000';

export async function getUser(username: string): Promise<UserState> {
  const resp = await fetch(`${GAME_API}/login`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ username }),
  });

  if (!resp.ok) {
    throw Error(`getUser failed: `);
  }

  const payload = await resp.text();
  const result = JSONParse(IsUserState)(payload);
  switch (result.type) {
    case 'Ok':
      return result.value;
    case 'Err':
      throw result.error;
  }
}

export async function getPaymentLink(
  userId: string,
  currency: string
): Promise<string> {
  const resp = await fetch(`${GAME_API}/create-link`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ userId, currency }),
  });

  if (!resp.ok) {
    throw Error(`getPaymentLink failed: `);
  }

  const payload = await resp.text();
  const result = JSONParse(IsPaymentLinkResponse)(payload);
  switch (result.type) {
    case 'Ok':
      return result.value.yubiLink;
    case 'Err':
      throw result.error;
  }
}

export async function playJanken(move: JankenMove): Promise<PlayResponse> {
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
