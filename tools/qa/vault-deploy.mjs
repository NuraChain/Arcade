import { readFileSync } from 'node:fs';
import { createPublicClient, createWalletClient, http, parseEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { hardhat } from 'viem/chains';

export const VAULT_ADMIN_KEY = '0xdbda1821b80551c9d65939329250298aa3472ba22feea921c0cf5d620ea67b97';
export const VAULT_REFEREE_KEY = '0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6';

export const VAULT_FEE = 500;
export const VAULT_MAX_STAKE = parseEther('1000');
export const VAULT_RECLAIM_AFTER = 3n * 24n * 3600n;

export const vaultArtifact = (root = process.env.QA_CONTRACTS ?? '../SmartContract/artifacts/contracts/baziche') =>
    JSON.parse(readFileSync(`${ root }/ArcadeVault.sol/ArcadeVault.json`, 'utf8'));

export async function deployVault(rpc = process.env.QA_RPC ?? 'http://127.0.0.1:8645', root = undefined)
{
    const { abi, bytecode } = vaultArtifact(root);
    const admin = privateKeyToAccount(VAULT_ADMIN_KEY);
    const referee = privateKeyToAccount(VAULT_REFEREE_KEY);
    const chain = { ...hardhat, rpcUrls: { default: { http: [rpc] } } };
    const wallet = createWalletClient({ account: admin, chain, transport: http(rpc) });
    const reader = createPublicClient({ chain, transport: http(rpc) });

    const hash = await wallet.deployContract({
        abi,
        bytecode,
        args: [admin.address, referee.address, VAULT_FEE, VAULT_MAX_STAKE, VAULT_RECLAIM_AFTER]
    });
    const receipt = await reader.waitForTransactionReceipt({ hash });

    return {
        vault: receipt.contractAddress,
        admin: admin.address,
        referee: referee.address,
        refereeKey: VAULT_REFEREE_KEY,
        chainId: await reader.getChainId()
    };
}

if (import.meta.url === `file:///${ process.argv[1].replaceAll('\\', '/') }` || import.meta.url.endsWith(process.argv[1].replaceAll('\\', '/')))
{
    console.log(JSON.stringify(await deployVault()));
}
