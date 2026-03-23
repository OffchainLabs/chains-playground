import { Address, Chain, defineChain, parseAbi, PublicClient } from 'viem';
import { readNodeConfigFile } from './node-configuration';
import 'dotenv/config';
import { readChainConfigFile, readCoreContractsFile } from './helpers';

export const getChainInformation = () => {
  if (!process.env.NITRO_RPC_URL || !process.env.NITRO_PORT) {
    throw new Error(
      `Can't get arbitrumChainConfig without NITRO_RPC_URL and NITRO_PORT. Set these variables in the .env file.`,
    );
  }

  const nodeConfig = readNodeConfigFile('rpc');
  const arbitrumChainConfig = JSON.parse(nodeConfig.chain!['info-json']!)[0];
  const chainId = Number(arbitrumChainConfig['chain-id']);

  const chainRpc = process.env.NITRO_RPC_URL + ':' + process.env.NITRO_PORT;
  const blockExplorerUrl = 'http://localhost';

  return defineChain({
    id: chainId,
    name: arbitrumChainConfig['chain-name'],
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

export const getChainConfiguration = () => {
  const nodeConfig = readNodeConfigFile('rpc');
  const arbitrumChainConfig = JSON.parse(nodeConfig.chain!['info-json']!)[0];
  return arbitrumChainConfig;
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
