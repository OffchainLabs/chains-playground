import { createPublicClient, http } from 'viem';
import { arbitrum, arbitrumNova, arbitrumSepolia } from 'viem/chains';
import { getWethAddress } from '@arbitrum/chain-sdk/utils';
import {
  readChainConfigFile,
  readCoreContractsFile,
  readTokenBridgeContractsFile,
  getChainConfigFromChainId,
  getRpcUrl,
} from '../../src/utils/helpers';
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

  const coreContracts = readCoreContractsFile();
  console.log('Core contracts:', coreContracts);

  const tokenBridgeContracts = readTokenBridgeContractsFile();
  console.log('');
  console.log('Token bridge contracts:', tokenBridgeContracts);

  const chainConfig = readChainConfigFile();
  const stakeToken = getWethAddress(parentChainPublicClient);

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
