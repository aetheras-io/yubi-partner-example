import React, { useState, useEffect, useCallback } from 'react'
import './App.css'
import Janken from './janken'
import * as API from './api'
import { UserState, UserTuple } from './types'
import useInterval from './hooks'

type State = {
    user: UserState
}

function App() {
    const [state, setState] = useState<State | undefined>()

    // keep state updated
    useInterval(
        async () => {
            if (state?.user) {
                let user = await API.login(state?.user.id)
                setState((prev) => {
                    return prev ? { ...prev, user } : prev
                })
            }
        },
        state?.user ? 2000 : null
    )

    function setUser(user: UserState) {
        setState((prev) => (prev ? { ...prev, user } : { user }))
    }

    return (
        <div className="App">
            {state ? (
                <div>
                    <UserMenu user={state.user} />
                    <Janken userId={state.user.id} updateUser={setUser} />
                    <Transactions user={state.user} />
                </div>
            ) : (
                <UserSelection setUser={setUser} />
            )}
        </div>
    )
}

type WithdrawState = 'sending' | 'idle'
type TxState = { txns: Array<any>; state: 'sending' | 'idle' }

var windowRef: any = null
function UserMenu(props: { user: UserState }) {
    const { user } = props
    const [state, setState] = useState<WithdrawState>('idle')
    const [address, setAddress] = useState<string>('')
    const [applyAmount, setApplyAmount] = useState<string>('')
    const [network, setNetwork] = useState('')

    const sendYubiWithdrawal = useCallback(async () => {
        if (state === 'idle') {
            setState('sending')
            try {
                await API.delay(1000)
                await API.withdrawOnYubi(user.id, 'Tether', 50)
                alert('Withdrawal Yubi Request of $50 USDT accepted')
                setState('idle')
            } catch (e) {
                console.log(e)
                alert('Withdrawal failed:' + e.message)
                setState('idle')
            }
        } else {
            console.log('withdraw request in flight')
        }
    }, [user, state, setState])

    const sendChainWithdrawal = useCallback(async () => {
        if (state === 'idle' && address) {
            setState('sending')
            try {
                await API.delay(1000)
                await API.withdrawOnChain(user.id, address, 'Tether', 50)
                alert('Withdrawal Chain Request of $50 USDT accepted')
                setState('idle')
            } catch (e) {
                console.log(e)
                alert('Withdrawal failed:' + e)
                setState('idle')
            }
        } else {
            console.log('withdraw request in flight')
        }
    }, [user, state, setState, address])

    const handleAddressChange = (evt: any) => {
        console.log(evt.currentTarget.value)
        setAddress(evt.currentTarget.value)
    }

    const handleApplyAmountChange = (evt: any) => {
        let string_num = evt.currentTarget.value
        if (string_num.match(/^(\d+\.)?\d*$/)) {
            console.log("setApplyAmount", string_num)
            setApplyAmount(string_num)
        }
    }

    if (!user) {
        return null
    }

    const pendingRequest = state !== 'idle'
    return (
        <div>
            <p>
                [{user.username}] Credits: {user.balance} USDT{' '}
                <br />
                <span>apply amount: </span>
                <input value={applyAmount} onChange={handleApplyAmountChange}></input>
                <button
                    onClick={() => {
                        windowRef = window.open()
                            ; (async () => {
                                const yubiLink = await API.getDepositLink(user.id, applyAmount, network)
                                windowRef.location = yubiLink
                                windowRef.name = '_blank'
                            })()
                    }}
                >
                    Deposit
                </button>
                <br />
                <br />
                <button onClick={() => setNetwork('')}>
                    Not specify network
                </button>
                <button onClick={() => setNetwork('TRC20')}>
                    TRC20
                </button>
                <button onClick={() => setNetwork('ERC20')}>
                    ERC20
                </button>
                <span> network: {network}</span>
                <br />
                <br />
                {/* <button disabled={pendingRequest} onClick={sendYubiWithdrawal}>
                    Withdraw Yubi(50)
                </button> */}
                <br />
                <span>withdraw address: </span>
                <input value={address} onChange={handleAddressChange}></input>
                <button
                    disabled={pendingRequest || !address}
                    onClick={sendChainWithdrawal}
                >
                    Withdraw Chain(50)
                </button>
            </p>
        </div>
    )
}

function Transactions(props: { user: UserState }) {
    const { user } = props
    const [txState, setTxState] = useState<TxState>({
        txns: [],
        state: 'idle',
    })

    useEffect(() => {
        ; (async () => {
            setTxState((prev) => ({ ...prev, state: 'sending' }))
            let txns = await API.getTransactions(user.id)
            setTxState((prev) => ({ ...prev, state: 'idle', txns }))
        })()
    }, [user.id, setTxState])

    // keep state updated
    useInterval(async () => {
        if (user.id) {
            setTxState((prev) => ({ ...prev, state: 'sending' }))
            let txns = await API.getTransactions(user.id)
            setTxState((prev) => ({ ...prev, state: 'idle', txns }))
        }
    }, 2000)

    const rows = txState.txns.map((tx, i) => (
        <tr key={`tx-${i}`}>
            <td>{tx.kind}</td>
            <td>{tx.amount.kind}</td>
            <td>{tx.amount.value}</td>
        </tr>
    ))
    return (
        <table style={{ marginLeft: 'auto', marginRight: 'auto' }}>
            <tbody>
                <tr>
                    <th>Action</th>
                    <th>Currency</th>
                    <th>Value</th>
                </tr>
                {rows}
            </tbody>
        </table>
    )
}

type SelectionState = {
    selectedUser?: string
    allUsers?: Array<UserTuple>
}

function UserSelection(props: { setUser: (user: UserState) => void }) {
    const { setUser } = props
    const [state, setState] = useState<SelectionState>({
        selectedUser: undefined,
        allUsers: undefined,
    })

    // load all available users
    useEffect(() => {
        ; (async () => {
            if (!state.allUsers) {
                let users = await API.getAllUsers()
                setState((prev) => ({ ...prev, allUsers: users }))
            }
        })()
    }, [state, setState])

    useEffect(() => {
        ; (async () => {
            if (state.selectedUser) {
                let resp = await API.login(state.selectedUser)
                setUser(resp)
            }
        })()
    }, [state, setUser])

    if (!state.allUsers) {
        return <h1>Loading</h1>
    }

    if (state.allUsers.length === 0) {
        return <h1>Error: No users available</h1>
    }

    let buttons = state.allUsers.map((u, idx) => (
        <button
            key={`username_${idx}`}
            onClick={() =>
                setState((prev) => ({ ...prev, selectedUser: u.id }))
            }
        >
            {u.username}
        </button>
    ))

    return (
        <div>
            <h1>Choose a User</h1>
            {buttons}
        </div>
    )
}

const openInNewTab = (url: string) => {
    const newWindow = window.open(url, '_blank', 'noopener,noreferrer')
    if (newWindow) {
        newWindow.opener = null
    }
}

export default App
