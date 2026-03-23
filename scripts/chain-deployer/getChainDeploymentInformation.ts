import {
  readChainConfigFile,
  readCoreContractsFile,
  readTokenBridgeContractsFile,
} from '../../src/utils/helpers';
import 'dotenv/config';

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
  console.log('');
  console.log('Chain configuration:');
  console.log(JSON.stringify(chainConfig));
};

// Calling main
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
