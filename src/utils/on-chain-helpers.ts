import { parseAbi, PublicClient } from 'viem';
import { applyBuffer, readCoreContractsFile } from './helpers';

// Get core contracts
const coreContracts = readCoreContractsFile();

//
// Gas estimation helpers
//
export const calculateMaxSubmissionCost = async (
  publicClient: PublicClient,
  dataLength: bigint,
) => {
  if (!coreContracts) {
    throw new Error(
      'Core contracts information not found. Please run the deploy script first to generate the core contracts file.',
    );
  }

  // Get current base fee
  const gasPrice = await publicClient.getGasPrice();

  // Estimate submission cost
  const maxSubmissionCost = await publicClient.readContract({
    address: coreContracts.inbox,
    abi: parseAbi([
      'function calculateRetryableSubmissionFee(uint256,uint256) public view returns (uint256)',
    ]),
    functionName: 'calculateRetryableSubmissionFee',
    args: [dataLength, BigInt(applyBuffer(gasPrice))],
  });

  return maxSubmissionCost;
};
