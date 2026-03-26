import { Address, Chain } from 'viem';
import { mainnet, sepolia, arbitrum, arbitrumNova, arbitrumSepolia } from 'viem/chains';
import { readFileSync, writeFileSync } from 'fs';
import { ChainConfig, CoreContracts, registerCustomParentChain } from '@arbitrum/chain-sdk';
import { getCustomParentChains } from '@arbitrum/chain-sdk/chains';
import { TokenBridgeContracts } from '../types';
import * as readline from 'readline';
import 'dotenv/config';

const supportedChains = { mainnet, sepolia, arbitrum, arbitrumNova, arbitrumSepolia };

//
// Small helpers
//
export const delay = (ms: number) => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};

export const promptQuestion = (question: string): Promise<string> => {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question(`${question}: `, (answer) => {
      resolve(answer);
      rl.close();
    });
  });
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const deepMerge = (target: any, source: any): any => {
  for (const key in source) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      if (!target[key]) target[key] = {};
      target[key] = deepMerge(target[key], source[key]);
    } else {
      target[key] = source[key];
    }
  }

  return target;
};

//
// Viem helpers
//
export const sanitizePrivateKey = (privateKey: string): `0x${string}` => {
  if (!privateKey.startsWith('0x')) {
    return `0x${privateKey}`;
  }

  return privateKey as `0x${string}`;
};

export const getBlockExplorerUrl = (chain: Chain) => {
  return chain.blockExplorers?.default.url;
};

export const isParentChainSupported = (chainId: number): boolean => {
  for (const chain of Object.values(supportedChains)) {
    if ('id' in chain) {
      if (chain.id === chainId) {
        return true;
      }
    }
  }

  return false;
};

export const getChainConfigFromChainId = (chainId: number) => {
  for (const chain of Object.values(supportedChains)) {
    if ('id' in chain) {
      if (chain.id === chainId) {
        return chain;
      }
    }
  }

  // If the chain was not found within the supported chains, we register it in the Arbitrum Chain SDK
  if (
    !process.env.PARENT_CHAIN_RPC_URL ||
    !process.env.ROLLUPCREATOR_FACTORY_ADDRESS ||
    !process.env.WETH_ADDRESS ||
    !process.env.CHAIN_MAX_DATA_SIZE
  ) {
    throw new Error(
      `Chain with id ${chainId} isn't supported out of the box. To register it, set the following env variables: PARENT_CHAIN_RPC_URL, ROLLUPCREATOR_FACTORY_ADDRESS, WETH_ADDRESS, CHAIN_MAX_DATA_SIZE.`,
    );
  }

  const parentChainName = 'Parent chain';
  const rollupCreatorFactoryAddress = process.env.ROLLUPCREATOR_FACTORY_ADDRESS as Address;
  const wethAddress = process.env.WETH_ADDRESS as Address;
  const tokenBridgeCreatorFactoryAddress = (process.env.TOKENBRIDGECREATOR_FACTORY_ADDRESS ||
    '0x2000000000000000000000000000000000000000') as Address;
  registerCustomParentChain({
    id: chainId,
    name: parentChainName,
    network: parentChainName.replace(/\s+/g, '-').toLowerCase(),
    nativeCurrency: {
      name: 'Ether',
      symbol: 'ETH',
      decimals: 18,
    },
    rpcUrls: {
      public: {
        http: [process.env.PARENT_CHAIN_RPC_URL],
      },
      default: { http: [process.env.PARENT_CHAIN_RPC_URL] },
    },

    contracts: {
      rollupCreator: { address: rollupCreatorFactoryAddress },
      tokenBridgeCreator: { address: tokenBridgeCreatorFactoryAddress },
      weth: { address: wethAddress },
    },
  });
  return getCustomParentChains().find((c) => c.id === chainId) as Chain;
};

export const getRpcUrl = (chain: Chain) => {
  return chain.rpcUrls.default.http[0];
};

//
// Gas estimation helpers
//
export const applyBuffer = (estimatedValue: bigint) => {
  const appliedGasBuffer = 1 + Number(process.env.BUFFER_INCREASE_PERCENTAGE) / 100;
  return BigInt(Math.ceil(Number(estimatedValue) * appliedGasBuffer));
};

//
// Contract JSON file helpers
//
export const saveChainConfigFile = (chainConfig: ChainConfig): string => {
  const configDir = 'chainConfig';
  const chainConfigFilename = 'chain-config.json';
  const filePath = configDir + '/' + chainConfigFilename;
  writeFileSync(filePath, JSON.stringify(chainConfig, null, 2));

  return filePath;
};

export const readChainConfigFile = (): ChainConfig => {
  const configDir = 'chainConfig';
  const chainConfigFilename = 'chain-config.json';
  const filePath = configDir + '/' + chainConfigFilename;
  return JSON.parse(readFileSync(filePath, 'utf8'));
};

export const saveCoreContractsFile = (coreContracts: CoreContracts): string => {
  const configDir = 'chainConfig';
  const coreContractsFilename = 'core-contracts.json';
  const filePath = configDir + '/' + coreContractsFilename;
  writeFileSync(filePath, JSON.stringify(coreContracts, null, 2));

  return filePath;
};

export const readCoreContractsFile = (): CoreContracts => {
  const configDir = 'chainConfig';
  const coreContractsFilename = 'core-contracts.json';
  const filePath = configDir + '/' + coreContractsFilename;
  return JSON.parse(readFileSync(filePath, 'utf8'));
};

// TODO: once TokenBridgeContracts is exported in the Arbitrum Chain SDK, change the type of the parameter received
export const saveTokenBridgeContractsFile = (
  tokenBridgeContracts: TokenBridgeContracts,
): string => {
  const configDir = 'chainConfig';
  const tokenBridgeContractsFilename = 'token-bridge-contracts.json';
  const filePath = configDir + '/' + tokenBridgeContractsFilename;
  writeFileSync(filePath, JSON.stringify(tokenBridgeContracts, null, 2));

  return filePath;
};

export const readTokenBridgeContractsFile = (): TokenBridgeContracts => {
  const configDir = 'chainConfig';
  const tokenBridgeContractsFilename = 'token-bridge-contracts.json';
  const filePath = configDir + '/' + tokenBridgeContractsFilename;
  return JSON.parse(readFileSync(filePath, 'utf8'));
};

