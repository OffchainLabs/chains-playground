import { createPublicClient, http, zeroAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  getBlockExplorerUrl,
  getChainConfigFromChainId,
  getRpcUrl,
  readChainConfigFile,
  readCoreContractsFile,
  sanitizePrivateKey,
  saveTokenBridgeContractsFile,
} from '../../src/utils/helpers';
import { getChainNativeToken } from '../../src/utils/chain-info-helpers';
import 'dotenv/config';
import {
  createTokenBridgeEnoughCustomFeeTokenAllowance,
  createTokenBridgePrepareCustomFeeTokenApprovalTransactionRequest,
  createTokenBridgePrepareSetWethGatewayTransactionReceipt,
  createTokenBridgePrepareTransactionReceipt,
  enqueueTokenBridgePrepareSetWethGatewayTransactionRequest,
  enqueueTokenBridgePrepareTransactionRequest,
} from '@arbitrum/chain-sdk';

// TEMP: Move these somewhere else (SDK or env variables)
const maxGasForContracts = 32_000_000n;
const maxGasForFactory = 6_000_000n;
const maxGasForWethGateway = 100_000n;
const maxSubmissionCostForFactory = 1_000_000_000_000_000n; // 0.001 ETH
const maxSubmissionCostForContracts = 1_000_000_000_000_000n; // 0.001 ETH
const maxSubmissionCostForWethGateway = 1_000_000_000_000n; // 0.0001 ETH
const defaultMaxGasPrice = 1_000_000_000n; // 1 gwei

// Check for required env variables
if (!process.env.DEPLOYER_PRIVATE_KEY || !process.env.PARENT_CHAIN_ID) {
  throw new Error(
    'The following environment variables must be present: DEPLOYER_PRIVATE_KEY, PARENT_CHAIN_ID',
  );
}

// Load accounts
const deployer = privateKeyToAccount(sanitizePrivateKey(process.env.DEPLOYER_PRIVATE_KEY));

// Set the parent chain and create a public client for it
const parentChainInformation = getChainConfigFromChainId(Number(process.env.PARENT_CHAIN_ID));
const parentChainPublicClient = createPublicClient({
  chain: parentChainInformation,
  transport: http(process.env.PARENT_CHAIN_RPC_URL || getRpcUrl(parentChainInformation)),
});

const main = async () => {
  console.log('*************************');
  console.log('* Token bridge deployer *');
  console.log('*************************');
  console.log('');

  const chainConfig = readChainConfigFile();
  if (!chainConfig) {
    throw new Error(
      'Chain configuration not found. Please run the deploy script first to generate the chain configuration file.',
    );
  }

  const coreContracts = readCoreContractsFile();
  if (!coreContracts) {
    throw new Error(
      'Core contracts information not found. Please run the deploy script first to generate the core contracts file.',
    );
  }

  // Check for native token
  const nativeToken = getChainNativeToken();

  if (nativeToken != zeroAddress) {
    // prepare transaction to approve custom fee token spend
    const allowanceParams = {
      nativeToken: nativeToken,
      owner: deployer.address,
      publicClient: parentChainPublicClient,
    };
    if (!(await createTokenBridgeEnoughCustomFeeTokenAllowance(allowanceParams))) {
      const approvalTxRequest =
        await createTokenBridgePrepareCustomFeeTokenApprovalTransactionRequest(allowanceParams);

      // sign and send the transaction
      const approvalTxHash = await parentChainPublicClient.sendRawTransaction({
        serializedTransaction: await deployer.signTransaction(approvalTxRequest),
      });

      // get the transaction receipt after waiting for the transaction to complete
      const approvalTxReceipt = await parentChainPublicClient.waitForTransactionReceipt({
        hash: approvalTxHash,
      });

      console.log(
        `Tokens approved in ${getBlockExplorerUrl(parentChainInformation)}/tx/${
          approvalTxReceipt.transactionHash
        }`,
      );
    }
  }

  const txRequest = await enqueueTokenBridgePrepareTransactionRequest({
    params: {
      rollup: coreContracts.rollup,
      rollupOwner: deployer.address,
    },
    account: deployer.address,
    parentChainPublicClient,
    maxGasForContracts,
    maxGasForFactory,
    maxGasPrice: defaultMaxGasPrice,
    maxSubmissionCostForFactory,
    maxSubmissionCostForContracts,
  });

  // sign and send the transaction
  console.log(`Deploying the TokenBridge...`);
  const txHash = await parentChainPublicClient.sendRawTransaction({
    serializedTransaction: await deployer.signTransaction(txRequest),
  });

  // get the transaction receipt after waiting for the transaction to complete
  const txReceipt = createTokenBridgePrepareTransactionReceipt(
    await parentChainPublicClient.waitForTransactionReceipt({ hash: txHash }),
  );
  console.log(
    `Deployed in ${getBlockExplorerUrl(parentChainInformation)}/tx/${txReceipt.transactionHash}`,
  );

  // fetching the TokenBridge contracts
  const tokenBridgeContracts = await txReceipt.getTokenBridgeContracts({
    parentChainPublicClient,
  });
  console.log(`TokenBridge contracts:`, tokenBridgeContracts);

  // Save token bridge contracts in JSON file
  const tokenBridgeContractsFilePath = saveTokenBridgeContractsFile(tokenBridgeContracts);
  console.log(`TokenBridge contracts written to ${tokenBridgeContractsFilePath}`);

  if (nativeToken == zeroAddress) {
    // set weth gateway
    const setWethGatewayTxRequest = await enqueueTokenBridgePrepareSetWethGatewayTransactionRequest(
      {
        rollup: coreContracts.rollup,
        account: deployer.address,
        rollupDeploymentBlockNumber: BigInt(coreContracts.deployedAtBlockNumber),
        parentChainPublicClient,
        gasLimit: maxGasForWethGateway,
        maxGasPrice: defaultMaxGasPrice,
        maxSubmissionCost: maxSubmissionCostForWethGateway,
      },
    );

    // sign and send the transaction
    const setWethGatewayTxHash = await parentChainPublicClient.sendRawTransaction({
      serializedTransaction: await deployer.signTransaction(setWethGatewayTxRequest),
    });

    // get the transaction receipt after waiting for the transaction to complete
    const setWethGatewayTxReceipt = createTokenBridgePrepareSetWethGatewayTransactionReceipt(
      await parentChainPublicClient.waitForTransactionReceipt({ hash: setWethGatewayTxHash }),
    );

    console.log(
      `Weth gateway set in ${getBlockExplorerUrl(parentChainInformation)}/tx/${
        setWethGatewayTxReceipt.transactionHash
      }`,
    );
  }
};

// Calling main
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
