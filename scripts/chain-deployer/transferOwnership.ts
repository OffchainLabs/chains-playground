import {
  concatHex,
  createPublicClient,
  createWalletClient,
  custom,
  defineChain,
  encodeFunctionData,
  getAddress,
  http,
  keccak256,
  toHex,
  zeroAddress,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  upgradeExecutorEncodeFunctionData,
  upgradeExecutorPrepareAddExecutorTransactionRequest,
  upgradeExecutorPrepareRemoveExecutorTransactionRequest,
} from '@arbitrum/chain-sdk';
import {
  getBlockExplorerUrl,
  sanitizePrivateKey,
  readTokenBridgeContractsFile,
  getChainConfigFromChainId,
  getRpcUrl,
  readCoreContractsFile,
  readChainConfigFile,
} from '../../src/utils/helpers';
import 'dotenv/config';
import { getChainNativeToken } from '../../src/utils/chain-info-helpers';
import {
  createRetryableTicketErc20ABI,
  createRetryableTicketEthABI,
} from '../../src/abis/createRetryableTicket';
import { upgradeExecutorABI } from '@arbitrum/chain-sdk/contracts/UpgradeExecutor.js';
import { arbOwnerABI, arbOwnerAddress } from '@arbitrum/chain-sdk/contracts/ArbOwner.js';
import { sendL2MessageABI } from '../../src/abis/sendL2Message';

// Check for required env variables
if (
  !process.env.DEPLOYER_PRIVATE_KEY ||
  !process.env.CHAIN_OWNER_ADDRESS ||
  !process.env.PARENT_CHAIN_ID
) {
  throw new Error(
    'The following environment variables must be present: DEPLOYER_PRIVATE_KEY, CHAIN_OWNER_ADDRESS, PARENT_CHAIN_ID',
  );
}

// Executor role hash
const UPGRADE_EXECUTOR_ROLE_EXECUTOR = keccak256(toHex('EXECUTOR_ROLE'));

// Gas defaults
const defaultMaxSubmissionCost = 200_000_000_000_000n; // 0.0002 ETH
const defaultMaxGasLimit = 2_000_000n; // 2 million gas
const defaultMaxGasPrice = 1_000_000_000n; // 1 gwei

// Load accounts
const deployer = privateKeyToAccount(sanitizePrivateKey(process.env.DEPLOYER_PRIVATE_KEY));
const chainOwnerAddress = getAddress(process.env.CHAIN_OWNER_ADDRESS);

// Set the parent chain and create a public client for it
const parentChainInformation = getChainConfigFromChainId(Number(process.env.PARENT_CHAIN_ID));
const parentChainPublicClient = createPublicClient({
  chain: parentChainInformation,
  transport: http(process.env.PARENT_CHAIN_RPC_URL || getRpcUrl(parentChainInformation)),
});
const parentChainWalletClient = createWalletClient({
  account: deployer,
  chain: parentChainInformation,
  transport: http(process.env.PARENT_CHAIN_RPC_URL || getRpcUrl(parentChainInformation)),
});

// Get all contracts
const coreContracts = readCoreContractsFile();
if (!coreContracts) {
  throw new Error(
    'Core contracts information not found. Please run the deploy script first to generate the core contracts file.',
  );
}

const tokenBridgeContracts = readTokenBridgeContractsFile();
if (!tokenBridgeContracts) {
  throw new Error(
    'Token bridge contracts information not found. Please run the deploy script first to generate the token bridge contracts file.',
  );
}

const chainConfig = readChainConfigFile();
if (!chainConfig) {
  throw new Error(
    'Chain configuration not found. Please run the deploy script first to generate the chain configuration file.',
  );
}

// Retryable ticket ABI depends on whether the chain has a native token or not
const nativeToken = getChainNativeToken();
const createRetryableTicketAbi =
  nativeToken === zeroAddress ? createRetryableTicketEthABI : createRetryableTicketErc20ABI;

// Creating an artificial wallet client for the child chain, to sign transactions
// The RPCs and block explorers won't be hit
const arbitrumChain = defineChain({
  id: chainConfig.chainId,
  name: 'Arbitrum Chain',
  network: 'arbitrum-chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: {
      http: ['http://localhost:1234/rpc'],
    },
    public: {
      http: ['http://localhost:1234/rpc'],
    },
  },
  blockExplorers: {
    default: { name: 'Blockscout', url: 'http://localhost:1234/blockscout' },
  },
});

// We need a custom transport because `signTransaction` calls eth_chainId to get the chain id
const arbitrumChainMockedWalletClient = createWalletClient({
  account: deployer,
  chain: arbitrumChain,
  transport: custom({
    async request({ method }) {
      if (method === 'eth_chainId') {
        return '0x' + chainConfig.chainId.toString(16);
      }
      throw new Error(`Unexpected RPC call: ${method}`);
    },
  }),
});

// Helper function to prepare a createRetryableTicket transaction
const prepareRetryableTicketThroughUpgradeExecutorTransactionRequest = async ({
  to,
  l2CallValue,
  maxSubmissionCost,
  excessFeeRefundAddress,
  callValueRefundAddress,
  gasLimit,
  maxFeePerGas,
  data,
}: {
  to: `0x${string}`;
  l2CallValue: bigint;
  maxSubmissionCost: bigint;
  excessFeeRefundAddress: `0x${string}`;
  callValueRefundAddress: `0x${string}`;
  gasLimit: bigint;
  maxFeePerGas: bigint;
  data: `0x${string}`;
}) => {
  // Deposit
  const deposit = maxSubmissionCost + gasLimit * maxFeePerGas;

  // Retryable ticket arguments
  const retryableTicketArgs = [
    to,
    l2CallValue,
    maxSubmissionCost,
    excessFeeRefundAddress,
    callValueRefundAddress,
    gasLimit,
    maxFeePerGas,
  ];
  if (nativeToken != zeroAddress) {
    retryableTicketArgs.push(deposit); // tokenTotalFeeAmount
  }
  retryableTicketArgs.push(data); // data

  // Encode the function data for createRetryableTicket
  const createRetryableTicketData = encodeFunctionData({
    abi: createRetryableTicketAbi,
    functionName: 'createRetryableTicket',
    args: retryableTicketArgs,
  });

  // Prepare transaction request
  const { request } = await parentChainPublicClient.simulateContract({
    account: deployer,
    address: coreContracts.upgradeExecutor,
    abi: upgradeExecutorABI,
    functionName: 'executeCall',
    args: [
      coreContracts.inbox, // target
      createRetryableTicketData, // targetCallData
    ],
    value: nativeToken == zeroAddress ? deposit : 0n,
  });

  return request;
};

const main = async () => {
  console.log('*****************************************');
  console.log('* Transferring ownership to chain owner *');
  console.log('*****************************************');
  console.log('');

  //
  // Add chain owner to parent-chain's UpgradeExecutor
  // (`deployer` has rights to perform this action)
  //
  const addParentChainExecutorTransactionRequest =
    await upgradeExecutorPrepareAddExecutorTransactionRequest({
      account: chainOwnerAddress,
      upgradeExecutorAddress: coreContracts.upgradeExecutor,
      executorAccountAddress: deployer.address,
      publicClient: parentChainPublicClient,
    });

  const addParentChainExecutorTransactionHash = await parentChainPublicClient.sendRawTransaction({
    serializedTransaction: await deployer.signTransaction(addParentChainExecutorTransactionRequest),
  });

  const addParentChainExecutorTransactionReceipt =
    await parentChainPublicClient.waitForTransactionReceipt({
      hash: addParentChainExecutorTransactionHash,
    });

  console.log(
    `Chain owner added as parent-chain executor in ${getBlockExplorerUrl(
      parentChainInformation,
    )}/tx/${addParentChainExecutorTransactionReceipt.transactionHash}`,
  );

  //
  // Add chain owner to child-chain's UpgradeExecutor (via RetryableTicket)
  // (the retryable ticket needs to be sent through the parent-chain's UpgradeExecutor, since its alias has executor rights on the child-chain's UpgradeExecutor)
  //
  const grantRoleCalldata = encodeFunctionData({
    abi: upgradeExecutorABI,
    functionName: 'grantRole',
    args: [
      UPGRADE_EXECUTOR_ROLE_EXECUTOR, // role
      chainOwnerAddress, // account
    ],
  });
  const addChildChainExecutorData = upgradeExecutorEncodeFunctionData({
    functionName: 'executeCall',
    args: [
      tokenBridgeContracts.orbitChainContracts.upgradeExecutor, // target
      grantRoleCalldata, // targetCallData
    ],
  });

  const addChildChainExecutorTransactionRequest =
    await prepareRetryableTicketThroughUpgradeExecutorTransactionRequest({
      to: tokenBridgeContracts.orbitChainContracts.upgradeExecutor,
      l2CallValue: 0n,
      maxSubmissionCost: defaultMaxSubmissionCost,
      excessFeeRefundAddress: chainOwnerAddress,
      callValueRefundAddress: chainOwnerAddress,
      gasLimit: defaultMaxGasLimit,
      maxFeePerGas: defaultMaxGasPrice,
      data: addChildChainExecutorData,
    });

  const addChildChainExecutorTransactionHash = await parentChainWalletClient.writeContract(
    addChildChainExecutorTransactionRequest,
  );
  const addChildChainExecutorTransactionReceipt =
    await parentChainPublicClient.waitForTransactionReceipt({
      hash: addChildChainExecutorTransactionHash,
    });
  console.log(
    `Retryable ticket for adding the chain owner as child-chain executor, executed in: ${getBlockExplorerUrl(
      parentChainInformation,
    )}/tx/${addChildChainExecutorTransactionReceipt.transactionHash}`,
  );

  //
  // Add UpgradeExecutor to chain owner on child-chain (via RetryableTicket)
  // (send this by signing the transaction with the deployer and using Inbox.sendL2Message)
  //
  const addChainOwnerCalldata = encodeFunctionData({
    abi: arbOwnerABI,
    functionName: 'addChainOwner',
    args: [
      tokenBridgeContracts.orbitChainContracts.upgradeExecutor, // newOwner
    ],
  });

  const addChainOwnerSignedTransaction = await arbitrumChainMockedWalletClient.signTransaction({
    to: arbOwnerAddress,
    data: addChainOwnerCalldata,
    nonce: 0, // This would be the first transaction from this wallet
    gas: defaultMaxGasLimit,
    maxFeePerGas: defaultMaxGasPrice,
    maxPriorityFeePerGas: 0n,
  });

  // We need to concatenate the message type (1 byte) with the signed transaction bytes
  // InboxMessageKind.L2MessageType_signedTx is 4
  const addChainOwnerSendMessage = concatHex([
    toHex(4, { size: 1 }), // uint8
    addChainOwnerSignedTransaction, // the signed tx bytes
  ]);

  const { request: addChainOwnerTransactionRequest } =
    await parentChainPublicClient.simulateContract({
      account: deployer,
      address: coreContracts.inbox,
      abi: sendL2MessageABI,
      functionName: 'sendL2Message',
      args: [
        addChainOwnerSendMessage, // message
      ],
    });

  const addChainOwnerTransactionHash = await parentChainWalletClient.writeContract(
    addChainOwnerTransactionRequest,
  );
  const addChainOwnerTransactionReceipt = await parentChainPublicClient.waitForTransactionReceipt({
    hash: addChainOwnerTransactionHash,
  });
  console.log(
    `Retryable ticket for adding the upgrade executor as chain owner, executed in: ${getBlockExplorerUrl(
      parentChainInformation,
    )}/tx/${addChainOwnerTransactionReceipt.transactionHash}`,
  );

  //
  // Remove deployer from chain owner on child-chain (via RetryableTicket)
  // (send this by signing the transaction with the deployer and using Inbox.sendL2Message)
  //
  const removeChainOwnerCalldata = encodeFunctionData({
    abi: arbOwnerABI,
    functionName: 'removeChainOwner',
    args: [
      deployer.address, // ownerToRemove
    ],
  });

  const removeChainOwnerSignedTransaction = await arbitrumChainMockedWalletClient.signTransaction({
    to: arbOwnerAddress,
    data: removeChainOwnerCalldata,
    nonce: 1, // This would be the second transaction from this wallet
    gas: defaultMaxGasLimit,
    maxFeePerGas: defaultMaxGasPrice,
    maxPriorityFeePerGas: 0n,
  });

  // We need to concatenate the message type (1 byte) with the signed transaction bytes
  // InboxMessageKind.L2MessageType_signedTx is 4
  const removeChainOwnerSendMessage = concatHex([
    toHex(4, { size: 1 }), // uint8
    removeChainOwnerSignedTransaction, // the signed tx bytes
  ]);

  const { request: removeChainOwnerTransactionRequest } =
    await parentChainPublicClient.simulateContract({
      account: deployer,
      address: coreContracts.inbox,
      abi: sendL2MessageABI,
      functionName: 'sendL2Message',
      args: [
        removeChainOwnerSendMessage, // message
      ],
    });

  const removeChainOwnerTransactionHash = await parentChainWalletClient.writeContract(
    removeChainOwnerTransactionRequest,
  );
  const removeChainOwnerTransactionReceipt =
    await parentChainPublicClient.waitForTransactionReceipt({
      hash: removeChainOwnerTransactionHash,
    });
  console.log(
    `Retryable ticket for removing the deployer as chain owner, executed in: ${getBlockExplorerUrl(
      parentChainInformation,
    )}/tx/${removeChainOwnerTransactionReceipt.transactionHash}`,
  );

  //
  // Remove deployer from child-chain's UpgradeExecutor (via RetryableTicket)
  // (the retryable ticket needs to be sent through the parent-chain's UpgradeExecutor, since its alias has executor rights on the child-chain's UpgradeExecutor)
  //
  const revokeRoleCalldata = encodeFunctionData({
    abi: upgradeExecutorABI,
    functionName: 'revokeRole',
    args: [
      UPGRADE_EXECUTOR_ROLE_EXECUTOR, // role
      deployer.address, // account
    ],
  });
  const removeChildChainExecutorData = upgradeExecutorEncodeFunctionData({
    functionName: 'executeCall',
    args: [
      tokenBridgeContracts.orbitChainContracts.upgradeExecutor, // target
      revokeRoleCalldata, // targetCallData
    ],
  });

  const removeChildChainExecutorTransactionRequest =
    await prepareRetryableTicketThroughUpgradeExecutorTransactionRequest({
      to: tokenBridgeContracts.orbitChainContracts.upgradeExecutor,
      l2CallValue: 0n,
      maxSubmissionCost: defaultMaxSubmissionCost,
      excessFeeRefundAddress: chainOwnerAddress,
      callValueRefundAddress: chainOwnerAddress,
      gasLimit: defaultMaxGasLimit,
      maxFeePerGas: defaultMaxGasPrice,
      data: removeChildChainExecutorData,
    });

  const removeChildChainExecutorTransactionHash = await parentChainWalletClient.writeContract(
    removeChildChainExecutorTransactionRequest,
  );
  const removeChildChainExecutorTransactionReceipt =
    await parentChainPublicClient.waitForTransactionReceipt({
      hash: removeChildChainExecutorTransactionHash,
    });
  console.log(
    `Retryable ticket for removing the deployer as child-chain executor, executed in: ${getBlockExplorerUrl(
      parentChainInformation,
    )}/tx/${removeChildChainExecutorTransactionReceipt.transactionHash}`,
  );

  //
  // Remove deployer from parent-chain's UpgradeExecutor
  // (`deployer` has rights to perform this action)
  //
  const removeParentChainExecutorTransactionRequest =
    await upgradeExecutorPrepareRemoveExecutorTransactionRequest({
      account: deployer.address,
      upgradeExecutorAddress: coreContracts.upgradeExecutor,
      executorAccountAddress: deployer.address,
      publicClient: parentChainPublicClient,
    });

  const removeParentChainExecutorTransactionHash = await parentChainPublicClient.sendRawTransaction(
    {
      serializedTransaction: await deployer.signTransaction(
        removeParentChainExecutorTransactionRequest,
      ),
    },
  );

  const removeParentChainExecutorTransactionReceipt =
    await parentChainPublicClient.waitForTransactionReceipt({
      hash: removeParentChainExecutorTransactionHash,
    });

  console.log(
    `Deployer removed as parent-chain executor in ${getBlockExplorerUrl(
      parentChainInformation,
    )}/tx/${removeParentChainExecutorTransactionReceipt.transactionHash}`,
  );
};

// Calling main
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
