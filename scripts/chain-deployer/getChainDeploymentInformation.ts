import { createPublicClient, http } from 'viem';
import { arbitrum, arbitrumNova, arbitrumSepolia } from 'viem/chains';
import {
  readChainConfigFile,
  readCoreContractsFile,
  readTokenBridgeContractsFile,
  getChainConfigFromChainId,
  getRpcUrl,
} from '../../src/utils/helpers';
import { getChainStakeToken } from '../../src/utils/chain-info-helpers';
import 'dotenv/config';

const ARBITRUM_CHAIN_IDS: number[] = [arbitrum.id, arbitrumNova.id, arbitrumSepolia.id];

const parentChainId = Number(process.env.PARENT_CHAIN_ID);
const parentChainInformation = getChainConfigFromChainId(parentChainId);
const parentChainRpc = process.env.PARENT_CHAIN_RPC_URL || getRpcUrl(parentChainInformation);
const parentChainPublicClient = createPublicClient({
  chain: parentChainInformation,
  transport: http(parentChainRpc),
});

const main = async () => {
  console.log('********************************');
  console.log('* Chain deployment information *');
  console.log('********************************');
  console.log('');

  // Core contracts
  const coreContracts = readCoreContractsFile();
  if (!coreContracts) {
    throw new Error(
      'Core contracts information not found. Please run the deploy script first to generate the core contracts file.',
    );
  }

  console.log('Core contracts:', coreContracts);

  // Token bridge contracts
  const tokenBridgeContracts = readTokenBridgeContractsFile();
  if (!tokenBridgeContracts) {
    throw new Error(
      'Token bridge contracts information not found. Please run the deploy script first to generate the token bridge contracts file.',
    );
  }
  console.log('');
  console.log('Token bridge contracts:', tokenBridgeContracts);

  // Chain configuration
  const chainConfig = readChainConfigFile();
  if (!chainConfig) {
    throw new Error(
      'Chain configuration not found. Please run the deploy script first to generate the chain configuration file.',
    );
  }
  const stakeToken = await getChainStakeToken(parentChainPublicClient);

  const output = [
    {
      'chain-id': chainConfig.chainId,
      'parent-chain-id': parentChainId,
      'parent-chain-is-arbitrum': ARBITRUM_CHAIN_IDS.includes(parentChainId),
      'chain-name': process.env.ARBITRUM_CHAIN_NAME || `chain-${chainConfig.chainId}`,
      'chain-config': chainConfig,
      'rollup': {
        bridge: coreContracts.bridge,
        inbox: coreContracts.inbox,
        'sequencer-inbox': coreContracts.sequencerInbox,
        rollup: coreContracts.rollup,
        'validator-utils': coreContracts.validatorUtils,
        'validator-wallet-creator': coreContracts.validatorWalletCreator,
        'stake-token': stakeToken,
        'deployed-at': coreContracts.deployedAtBlockNumber,
      },
    },
  ];

  console.log(JSON.stringify(JSON.stringify(output)));
};

// Calling main
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
