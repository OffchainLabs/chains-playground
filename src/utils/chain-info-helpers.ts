import { Address, Chain, defineChain, parseAbi, PublicClient } from 'viem';
import 'dotenv/config';
import { readChainConfigFile, readCoreContractsFile } from './helpers';

export const getChainInformation = () => {
  if (!process.env.NITRO_RPC_URL || !process.env.NITRO_PORT) {
    throw new Error(
      `Can't get arbitrumChainConfig without NITRO_RPC_URL and NITRO_PORT. Set these variables in the .env file.`,
    );
  }

  const chainConfig = readChainConfigFile();
  if (!chainConfig) {
    throw new Error(
      'Chain configuration not found. Please run the deploy script first to generate the chain configuration file.',
    );
  }

  const chainRpc = process.env.NITRO_RPC_URL + ':' + process.env.NITRO_PORT;
  const blockExplorerUrl = 'http://localhost';

  return defineChain({
    id: chainConfig.chainId,
    name: 'Arbitrum chain',
    network: 'arbitrum-chain',
    nativeCurrency: {
      name: 'ETH',
      symbol: 'ETH',
      decimals: 18,
    },
    rpcUrls: {
      default: {
        http: [chainRpc],
      },
      public: {
        http: [chainRpc],
      },
    },
    blockExplorers: {
      default: { name: 'Blockscout', url: blockExplorerUrl },
    },
  });
};

export const chainIsL1 = (chain: Chain) => {
  return chain.id == 1 || chain.id == 11155111;
};

export const chainIsAnytrust = (): boolean => {
  const chainConfig = readChainConfigFile();
  if (chainConfig.arbitrum.DataAvailabilityCommittee == true) {
    return true;
  }

  return false;
};

export const getChainNativeToken = (): `0x${string}` => {
  const coreContracts = readCoreContractsFile();
  return coreContracts.nativeToken;
};

export const getChainStakeToken = async (
  parentChainPublicClient: PublicClient,
): Promise<Address> => {
  const coreContracts = readCoreContractsFile();
  const rollup = coreContracts.rollup;
  const stakeToken = await parentChainPublicClient.readContract({
    address: rollup,
    abi: parseAbi(['function stakeToken() public view returns (address)']),
    functionName: 'stakeToken',
  });

  return stakeToken;
};

export const getChainBaseStake = async (parentChainPublicClient: PublicClient): Promise<bigint> => {
  const coreContracts = readCoreContractsFile();
  const rollup = coreContracts.rollup;
  const baseStake = await parentChainPublicClient.readContract({
    address: rollup,
    abi: parseAbi(['function baseStake() public view returns (uint256)']),
    functionName: 'baseStake',
  });

  return baseStake;
};
