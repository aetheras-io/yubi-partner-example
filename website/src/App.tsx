import React, { useState, useEffect, useCallback } from 'react';
import './App.css';
import Janken from './janken';
import * as API from './api';
import { UserState, UserTuple } from './types';
import useInterval from './hooks';

type State = {
  user: UserState;
};

function App() {
  const [state, setState] = useState<State | undefined>();

  // keep state updated
  useInterval(
    async () => {
      if (state?.user) {
        let resp = await API.login(state?.user.id);
        setState((prev) => {
          return prev ? { ...prev, user: resp } : prev;
        });
      }
    },
    state?.user ? 2000 : null
  );

  function setUser(user: UserState) {
    console.log('set user');
    setState((prev) => (prev ? { ...prev, user } : { user }));
  }

  return (
    <div className="App">
      {state ? (
        <div>
          <UserMenu user={state.user} />
          <Janken userId={state.user.id} updateUser={setUser} />
        </div>
      ) : (
        <UserSelection setUser={setUser} />
      )}
    </div>
  );
}

type WithdrawState = 'sending' | 'idle';
function UserMenu(props: { user: UserState }) {
  const { user } = props;
  const [state, setState] = useState<WithdrawState>('idle');

  const sendWithdrawal = useCallback(async () => {
    if (state === 'idle') {
      setState('sending');
      try {
        await API.delay(1000);
        await API.withdraw(user.id, 'USDT', 50);
        alert('Withdrawal Request of $500 USDT accepted');
        setState('idle');
      } catch (e) {
        setState('idle');
      }
    } else {
      console.log('already withdrawing');
    }
  }, [user, state, setState]);

  if (!user) {
    return null;
  }

  const pendingRequest = state !== 'idle';

  return (
    <div>
      <p>
        [{user.username}] Credits: {user.balance} USDT{' '}
        <button
          onClick={async () => {
            const yubiLink = await API.getDepositLink(user.id);
            console.log(yubiLink);
            openInNewTab(yubiLink);
          }}
        >
          Deposit
        </button>
        <button disabled={pendingRequest} onClick={sendWithdrawal}>
          Withdraw(50)
        </button>
      </p>

      {/* <p> Yubi Link: {yubiLink}</p> */}
    </div>
  );
}

type SelectionState = {
  selectedUser?: string;
  allUsers?: Array<UserTuple>;
};

function UserSelection(props: { setUser: (user: UserState) => void }) {
  const { setUser } = props;
  const [state, setState] = useState<SelectionState>({
    selectedUser: undefined,
    allUsers: undefined,
  });

  // load all available users
  useEffect(() => {
    (async () => {
      if (!state.allUsers) {
        let users = await API.getAllUsers();
        setState((prev) => ({ ...prev, allUsers: users }));
      }
    })();
  }, [state, setState]);

  useEffect(() => {
    (async () => {
      if (state.selectedUser) {
        let resp = await API.login(state.selectedUser);
        setUser(resp);
      }
    })();
  }, [state, setUser]);

  if (!state.allUsers) {
    return <h1>Loading</h1>;
  }

  if (state.allUsers.length === 0) {
    return <h1>Error: No users available</h1>;
  }

  let buttons = state.allUsers.map((u, idx) => (
    <button
      key={`username_${idx}`}
      onClick={() => setState((prev) => ({ ...prev, selectedUser: u.id }))}
    >
      {u.username}
    </button>
  ));

  return (
    <div>
      <h1>Choose a User</h1>
      {buttons}
    </div>
  );
}

const openInNewTab = (url: string) => {
  const newWindow = window.open(url, '_blank', 'noopener,noreferrer');
  if (newWindow) {
    newWindow.opener = null;
  }
};

export default App;
