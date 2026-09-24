import { readFileSync } from 'node:fs';
import { createPublicClient, createWalletClient, encodeFunctionData, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { hardhat } from 'viem/chains';

import { WALLET_FIXTURES } from '../../server/src/db/wallet-fixtures.ts';

const RPC = process.env.RPC ?? 'http://127.0.0.1:8645';
const ROOT = process.env.QA_CONTRACTS ?? '../SmartContract/artifacts/contracts/profile';
const artifact = (name) => JSON.parse(readFileSync(`${ ROOT }/${ name }.sol/${ name }.json`, 'utf8'));

const deployer = privateKeyToAccount(WALLET_FIXTURES[0].privateKey);
const chain = { ...hardhat, rpcUrls: { default: { http: [RPC] } } };
const wallet = createWalletClient({ account: deployer, chain, transport: http(RPC) });
const reader = createPublicClient({ chain, transport: http(RPC) });

const deploy = async (name, args) =>
{
    const { abi, bytecode } = artifact(name);
    const hash = await wallet.deployContract({ abi, bytecode, args });
    const receipt = await reader.waitForTransactionReceipt({ hash });
    return receipt.contractAddress;
};

const core = artifact('NuraProfile');
const implementation = await deploy('NuraProfile', []);
const proxy = await deploy('NuraProfileProxy', [implementation, encodeFunctionData({ abi: core.abi, functionName: 'initialize', args: [deployer.address] })]);
const lens = await deploy('NuraProfileLens', [proxy]);

console.log(JSON.stringify({ implementation, proxy, lens, chainId: await reader.getChainId() }));
