import React, { useState, useEffect } from 'react';
import useInterval from './hooks';
import './App.css';
import * as API from './api';
import { UserState, UserTuple } from './types';

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

  return (
    <div className="App">
      {state ? (
        <Janken user={state.user} yubiLink={state.yubiLink} />
      ) : (
        <UserSelection setUser={setState} />
      )}
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
        console.log('all users: ', users);
        setState((prev) => ({ ...prev, allUsers: users }));
      }
    })();
  }, [state, setState]);

  useEffect(() => {
    (async () => {
      if (state.selectedUser) {
        let userState = await API.login(state.selectedUser);
        console.log('userState: ', userState);
        setUser(userState);
      }
    })();
  }, [state, setUser]);

  if (!state.allUsers) {
    return <h1>Loading</h1>;
  }

  if (state.allUsers.length === 0) {
    return <h1>Error: No users available</h1>;
  }

  console.log(state.allUsers);
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

function Janken(props: { user: UserState; yubiLink: string }) {
  const { user } = props;
  return (
    <div>
      <h1>Janken</h1>
      <p>User: {user.username}</p>
      <p>USDT Credits: {user.balance}</p>
    </div>
  );
}

export default App;
