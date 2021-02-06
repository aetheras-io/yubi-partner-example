import React, { useState, useEffect } from 'react';
import './App.css';
import Janken from './janken';
import * as API from './api';
import { UserState, UserTuple } from './types';
import useInterval from './hooks';

type State = {
  user: UserState;
  yubiLink: string;
};

function App() {
  const [state, setState] = useState<State | undefined>();

  // keep state updated
  useInterval(
    () => {
      console.log('tick');
    },
    state ? 1000 : null
  );

  function setUser(user: UserState) {
    setState((prev) => (prev ? { ...prev, user } : prev));
  }

  return (
    <div className="App">
      {state ? (
        <div>
          <UserMenu user={state.user} yubiLink={state.yubiLink} />
          <Janken userId={state.user.id} updateUser={setUser} />
        </div>
      ) : (
        <UserSelection setUser={setState} />
      )}
    </div>
  );
}

function UserMenu(props: { user: UserState; yubiLink: string }) {
  const { user, yubiLink } = props;

  if (!user) {
    return null;
  }

  return (
    <div>
      <p>
        [{user.username}] Credits: {user.balance} USDT{' '}
        <button
          title={yubiLink}
          onClick={() => {
            openInNewTab(yubiLink);
          }}
        >
          Deposit
        </button>
        <button
          title={yubiLink}
          onClick={() => {
            openInNewTab(yubiLink);
          }}
        >
          Withdraw
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

function UserSelection(props: { setUser: (state: State) => void }) {
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
