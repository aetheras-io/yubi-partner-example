export type Result<T, E> = { type: 'Ok'; value: T } | { type: 'Err'; error: E };

export const JSONParse = <T>(guard: (o: any) => o is T) => (
  data: string
): Result<T, Error> => {
  try {
    const value = JSON.parse(data);
    return guard(value)
      ? { type: 'Ok', value }
      : { type: 'Err', error: new Error('malformed json') };
  } catch (e) {
    return { type: 'Err', error: e };
  }
};

export type JankenMove = 'rock' | 'paper' | 'scissors';
export type JankenResult = 'win' | 'lose' | 'draw';

export interface UserState {}

export interface PaymentLinkResponse {
  yubiLink: string;
}

export interface PlayResponse {
  result: JankenResult;
  userState: UserState;
  value: number;
}

export function IsUserState(o: any): o is UserState {
  return (
    o !== null &&
    typeof o.id === 'string' &&
    typeof o.firstname === 'number' &&
    typeof o.balance === 'number'
  );
}

export function IsPaymentLinkResponse(o: any): o is PaymentLinkResponse {
  return o !== null && typeof o.yubiLink === 'string';
}

export function IsPlayResponse(o: any): o is PlayResponse {
  return (
    o !== null &&
    typeof o.result === 'string' &&
    (o.result === 'win' || o.result === 'lose' || o.result === 'draw') &&
    IsUserState(o.result) &&
    typeof o.value === 'number'
  );
}
