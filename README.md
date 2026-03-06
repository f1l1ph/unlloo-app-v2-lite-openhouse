# Unlloo

Unlloo is an EVM DeFi protocol for under-collateralized loans backed by reputation. It enables borrowers to access loans based on their on-chain reputation score, while lenders can earn interest by providing liquidity to the protocol.

The protocol features:

- **Reputation-based borrowing**: Loan eligibility and limits are determined by on-chain wallet activity
- **Liquidity pools**: Lenders can deposit assets and earn interest
- **Admin approval system**: Loan requests are reviewed and approved by administrators
- **Multi-chain reputation**: Analyzes wallet history across Ethereum, Arbitrum, Base, Avalanche, and Optimism

## How It Works

Unlloo is built on [Scaffold-ETH 2](https://github.com/scaffold-eth/scaffold-eth-2), a development framework for building dApps on Ethereum. The system consists of three main components:

### 1. **Smart Contracts** (Hardhat)

The core protocol logic is implemented in Solidity smart contracts:

- Loan lifecycle management (request, approval, borrowing, repayment)
- Liquidity pool management
- Interest calculations (compound interest for borrowers and lenders)
- Price oracle integration for USD conversions
- Protocol fee management

### 2. **Frontend** (Next.js)

A Next.js application built with Scaffold-ETH 2 that provides:

- User dashboard for reputation display and loan management
- Lending interface for liquidity providers
- Borrowing interface for loan requests
- Admin interface for loan approval/rejection
- Integration with smart contracts using Scaffold-ETH hooks

### 3. **Backend API** (NestJS)

A NestJS backend service that handles:

- Reputation calculation from multiple sources:
  - 3rd party services (HumanPassport, zPass, Webacy, EthosNetwork)
  - Custom creditworthiness analysis using Blockscout API
- Multi-chain wallet history analysis
- Reputation aggregation and scoring

### User Flow

1. User connects wallet to the frontend
2. Backend calculates reputation based on wallet history
3. User submits a loan request with desired parameters
4. System admin reviews and approves/rejects the request
5. If approved, user can borrow from available liquidity pools
6. Lenders can deposit assets into pools at any time to earn interest

## Project Structure

This is a Yarn monorepo containing three packages:

```
packages/
├── hardhat/     # Smart contracts and deployment scripts
├── nextjs/      # Frontend application (Scaffold-ETH 2)
└── api/         # Backend API (NestJS)
```

## Prerequisites

- **Node.js**: >= 20.18.3
- **Yarn**: 3.2.3 (package manager)
- **Git**: For cloning the repository

## Installation

1. Clone the repository:

```bash
git clone https://github.com/decenzio/unlloo-v2-app-lite
cd unlloo-v2-app-lite
```

2. Install dependencies:

```bash
yarn install
```

3. Set up environment variables:
   - Copy `.env.example` files in each package directory to `.env`
   - Configure the required environment variables for each package

## Running the Project

### Development Setup

To run all components in development mode:

1. **Start local blockchain** (in a separate terminal):

```bash
yarn chain
```

2. **Deploy smart contracts** (in a separate terminal):

```bash
yarn deploy
```

3. **Start frontend and backend** (runs both concurrently):

```bash
yarn dev
```

This will start:

- Frontend at `http://localhost:3001`
- Backend API at the configured port (check `packages/api/.env`)

### API (Backend)

```bash
# Start development server (with hot reload)
cd packages/api
yarn start:dev
```

For API performance testing and detailed response time metrics, see [API Performance Testing](./packages/api/tools/README.md).

## Deploying to Robinhood Chain Testnet

Robinhood Chain Testnet is an Arbitrum Orbit L2 on Ethereum (Chain ID: `46630`). The network is already configured in this repo.

### Network Details

| Parameter       | Value                                          |
| --------------- | ---------------------------------------------- |
| Chain ID        | `46630`                                        |
| RPC (public)    | `https://rpc.testnet.chain.robinhood.com`      |
| RPC (Alchemy)   | `https://robinhood-testnet.g.alchemy.com/v2/<YOUR_API_KEY>` |
| Native currency | ETH                                            |
| Block explorer  | https://explorer.testnet.chain.robinhood.com   |
| Faucet          | https://faucet.testnet.chain.robinhood.com     |

### Steps

1. **Get testnet ETH** from the [faucet](https://faucet.testnet.chain.robinhood.com) or by bridging Sepolia ETH.

2. **Set your environment variables** in `packages/hardhat/.env`:

```bash
DEPLOYER_PRIVATE_KEY=0x...          # your deployer wallet private key
ALCHEMY_API_KEY=your_alchemy_key    # recommended for reliable RPC
```

3. **Deploy contracts:**

```bash
yarn deploy --network robinhoodTestnet
```

4. **Verify contracts** on the Blockscout explorer (optional):

```bash
cd packages/hardhat
yarn hardhat --network robinhoodTestnet etherscan-verify
```

> **Note:** Since USDC has no official deployment on Robinhood Chain Testnet yet, the deploy script will automatically deploy a `MockERC20` (mUSDC) contract and use it as the default token.
