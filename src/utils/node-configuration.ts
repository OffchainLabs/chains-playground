import { Address, Chain } from 'viem';
import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'fs';
import {
  ChainConfig,
  CoreContracts,
  NodeConfig,
  PrepareNodeConfigParams,
  prepareNodeConfig,
} from '@arbitrum/chain-sdk';
import { DasNodeConfig, NodeType } from '../types';
import { chainIsL1 } from './chain-info-helpers';
import { deepMerge, isParentChainSupported } from './helpers';
import 'dotenv/config';

export const getNodeConfigFileName = (nodeType: NodeType): string => {
  switch (nodeType) {
    case 'batch-poster':
      return 'batch-poster-config.json';
    case 'staker':
      return 'staker-config.json';
  }

  return 'rpc-config.json';
};

export const getNodeConfigFileLocation = (
  nodeType: NodeType,
): {
  dir: string;
  fileName: string;
} => {
  const configDir = 'chainConfig/' + nodeType;
  const nodeConfigFilename = getNodeConfigFileName(nodeType);
  return {
    dir: configDir,
    fileName: nodeConfigFilename,
  };
};

export const buildNodeConfiguration = (
  chainConfig: ChainConfig,
  coreContracts: CoreContracts,
  batchPosterPrivateKey: `0x${string}`,
  validatorPrivateKey: `0x${string}`,
  stakeToken: Address,
  parentChainInformation: Chain,
  parentChainRpc: string,
): NodeConfig => {
  //
  // Preparing the node configuration
  //
  const nodeConfigParameters: PrepareNodeConfigParams = {
    chainName: process.env.ARBITRUM_CHAIN_NAME || 'My Arbitrum chain',
    chainConfig,
    coreContracts,
    batchPosterPrivateKey,
    validatorPrivateKey,
    stakeToken,
    parentChainId: parentChainInformation.id,
    parentChainRpcUrl: parentChainRpc,
    parentChainBeaconRpcUrl: chainIsL1(parentChainInformation)
      ? process.env.PARENT_CHAIN_BEACON_RPC_URL
      : undefined,

    // The following parameters are mandatory for non-supported parent chains
    // Note: here we assume the parent chain is not an Arbitrum chain
    parentChainIsArbitrum: isParentChainSupported(parentChainInformation.id) ? undefined : false,
  };
  let baseNodeConfig = prepareNodeConfig(nodeConfigParameters);

  if (process.env.DISABLE_L1_FINALITY === 'true') {
    const updatedNodeConfig = {
      node: {
        'parent-chain-reader': {
          'use-finality-data': false,
        },
        'delayed-sequencer': {
          'require-full-finality': false,
        },
        'batch-poster': {
          'data-poster': {
            'wait-for-l1-finality': false,
          },
        },
        'staker': {
          'data-poster': {
            'wait-for-l1-finality': false,
          },
        },
        'bold': {
          'rpc-block-number': 'latest',
          'state-provider-config': {
            'check-batch-finality': false,
          },
        },
      },
      execution: {
        'parent-chain-reader': {
          'use-finality-data': false,
        },
      },
    };
    baseNodeConfig = deepMerge(baseNodeConfig, updatedNodeConfig);
  }

  if (process.env.USE_FAST_L1_POSTING === 'true') {
    const updatedNodeConfig = {
      node: {
        'batch-poster': {
          'max-delay': '1m',
        },
        'staker': {
          'make-assertion-interval': '1m',
        },
        'bold': {
          'assertion-posting-interval': '1m',
        },
      },
    };
    baseNodeConfig = deepMerge(baseNodeConfig, updatedNodeConfig);
  }

  // Using a genesis file
  // (it should be present in chainConfig/genesis.json)
  if (process.env.USE_GENESIS_FILE === 'true') {
    // Copy the file to each of the node's folder
    distributeGenesisFileToNodeFolders('chainConfig/genesis.json');

    const updatedNodeConfig = {
      init: {
        'genesis-json-file': '/home/user/.arbitrum/genesis.json',
        'empty': false,
      },
    };
    baseNodeConfig = deepMerge(baseNodeConfig, updatedNodeConfig);
  }

  // Extra customizable options
  if (process.env.NITRO_PORT != '') {
    baseNodeConfig.http!.port = Number(process.env.NITRO_PORT);
  }

  //
  // NOTE:
  // The following configuration is added to the batch poster in the docker-compose file
  //    - --node.feed.output.enable
  //    - --node.feed.output.port=9642
  //
  // The following configuration is added to the staker and rpc in the docker-compose file
  //    - --execution.forwarding-target 'http://batch-poster:8449'
  //    - --node.feed.input.url ws://batch-poster:9642
  //

  return baseNodeConfig;
};

export const saveNodeConfigFile = (nodeType: NodeType, nodeConfig: NodeConfig): string => {
  const configDir = 'chainConfig/' + nodeType;
  const nodeConfigFilename = getNodeConfigFileName(nodeType);
  const filePath = configDir + '/' + nodeConfigFilename;
  writeFileSync(filePath, JSON.stringify(nodeConfig, null, 2));

  return filePath;
};

export const readNodeConfigFile = (nodeType: NodeType): NodeConfig => {
  const configDir = 'chainConfig/' + nodeType;
  const nodeConfigFilename = getNodeConfigFileName(nodeType);
  const filePath = configDir + '/' + nodeConfigFilename;
  return JSON.parse(readFileSync(filePath, 'utf8'));
};

export const splitConfigPerType = (
  baseNodeConfig: NodeConfig,
): {
  batchPosterConfig: NodeConfig;
  stakerConfig: NodeConfig;
  rpcConfig: NodeConfig;
} => {
  // Batch poster config
  const batchPosterConfig = JSON.parse(JSON.stringify(baseNodeConfig));
  if (batchPosterConfig.node && batchPosterConfig.node.staker) {
    delete batchPosterConfig.node.staker;
  }
  if (
    batchPosterConfig.node &&
    batchPosterConfig.node.bold &&
    batchPosterConfig.node.bold['assertion-posting-interval']
  ) {
    delete batchPosterConfig.node.bold['assertion-posting-interval'];
  }

  // Staker config
  const stakerConfig = JSON.parse(JSON.stringify(baseNodeConfig));
  if (stakerConfig.node && stakerConfig.node.sequencer) {
    delete stakerConfig.node.sequencer;
  }
  if (stakerConfig.node && stakerConfig.node['delayed-sequencer']) {
    delete stakerConfig.node['delayed-sequencer'];
  }
  if (stakerConfig.node && stakerConfig.node['batch-poster']) {
    delete stakerConfig.node['batch-poster'];
  }
  if (
    stakerConfig.node &&
    stakerConfig.node.dangerous &&
    stakerConfig.node.dangerous['no-sequencer-coordinator']
  ) {
    delete stakerConfig.node.dangerous['no-sequencer-coordinator'];
  }
  if (stakerConfig.execution && stakerConfig.execution.sequencer) {
    delete stakerConfig.execution.sequencer;
  }

  // RPC config
  const rpcConfig = JSON.parse(JSON.stringify(stakerConfig));
  if (rpcConfig.node && rpcConfig.node.staker) {
    delete rpcConfig.node.staker;
  }
  if (rpcConfig.node && rpcConfig.node.bold && rpcConfig.node.bold['assertion-posting-interval']) {
    delete rpcConfig.node.bold['assertion-posting-interval'];
  }

  return {
    batchPosterConfig,
    stakerConfig,
    rpcConfig,
  };
};

export const distributeGenesisFileToNodeFolders = (genesisFilePath: string) => {
  if (!existsSync(genesisFilePath)) {
    // Not throwing here to not break the flow if the genesis file is not provided
    console.log('Genesis file not found at path:', genesisFilePath);
    return;
  }

  const nodeTypes: NodeType[] = ['batch-poster', 'staker', 'rpc'];
  for (const nodeType of nodeTypes) {
    copyFileSync(genesisFilePath, getNodeConfigFileLocation(nodeType).dir + '/genesis.json');
  }
};

export const prepareDasConfig = (
  parentChainRpc: string,
  sequencerInboxAddress: Address,
): DasNodeConfig => {
  const dasNodeConfig: DasNodeConfig = {
    'data-availability': {
      'parent-chain-node-url': parentChainRpc,
      'sequencer-inbox-address': sequencerInboxAddress,
      'key': {
        'key-dir': '/home/user/.arbitrum/keys',
      },
      'local-cache': {
        enable: true,
      },
      'local-file-storage': {
        'enable': true,
        'data-dir': '/home/user/das-data',
      },
    },
    'enable-rpc': true,
    'rpc-addr': '0.0.0.0',
    'enable-rest': true,
    'rest-addr': '0.0.0.0',
    'log-level': 'INFO',
  };

  return dasNodeConfig;
};

export const saveDasNodeConfigFile = (dasNodeConfig: DasNodeConfig): string => {
  const configDir = 'chainConfig/das-server';
  const dasNodeConfigFilename = 'das-config.json';
  const filePath = configDir + '/' + dasNodeConfigFilename;
  writeFileSync(filePath, JSON.stringify(dasNodeConfig, null, 2));

  return filePath;
};
