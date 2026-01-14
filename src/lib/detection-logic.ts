import { Connection, PublicKey, AccountInfo } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";

interface EmptyAccount {
    address: PublicKey;
    lamports: number;
    owner: PublicKey;
    executable: boolean;
    rentEpoch: number;
    type: 'token' | 'nft' | 'associated-token' | 'metadata' | 'other' | 'unknown';
    programId: string;
}

/**
 * Detects empty token accounts and other accounts holding rent deposits
 * @param connection - Solana RPC connection
 * @param walletAddress - User's wallet public key
 * @returns Array of accounts that can be closed to reclaim SOL
 */
export async function detectReclaimableAccounts(
  connection: Connection,
  walletAddress: PublicKey
): Promise<EmptyAccount[]> {
  const reclaimableAccounts: EmptyAccount[] = [];

  try {
    // 1. Detect empty token accounts
    console.log('Scanning token accounts...');
    const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
      walletAddress,
      { programId: TOKEN_PROGRAM_ID },
      'confirmed'
    );

    for (const account of tokenAccounts.value) {
      const parsedData = account.account.data.parsed;
      if (parsedData.info.tokenAmount.amount === '0') {
        reclaimableAccounts.push({
          address: account.pubkey,
          lamports: account.account.lamports,
          owner: account.account.owner,
          executable: account.account.executable,
          rentEpoch: account.account.rentEpoch ?? 0,
          type: 'token',
          programId: TOKEN_PROGRAM_ID.toBase58()
        });
      }
      if (reclaimableAccounts.length % 50 === 0) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    // 2. Detect empty NFT/SPL token accounts
    console.log('Scanning for NFT accounts...');
    const nftAccounts = await connection.getParsedTokenAccountsByOwner(
      walletAddress,
      { programId: TOKEN_PROGRAM_ID },
      'confirmed'
    );

    for (const account of nftAccounts.value) {
      const parsedData = account.account.data.parsed;
      // NFTs have amount of 0 and decimals of 0
      if (
        parsedData.info.tokenAmount.amount === '0' &&
        parsedData.info.decimals === 0
      ) {
        const isAlreadyIncluded = reclaimableAccounts.some(a =>
          a.address.equals(account.pubkey)
        );
        if (!isAlreadyIncluded) {
            const programId = account.account.owner.toBase58();
          reclaimableAccounts.push({
            address: account.pubkey,
            lamports: account.account.lamports,
            owner: account.account.owner,
            executable: account.account.executable,
            rentEpoch: account.account.rentEpoch ?? 0,
            type: 'nft',
            programId
          });
        }
      }
    }

    // 3. Detect empty Associated Token Accounts (ATAs)
    console.log('Scanning associated token accounts...');
    const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
      'ATokenGPvbdGVqstVQmcLsNZAqeEbtQaMy63xtto2CXv'
    );

    const ataAccounts = await connection.getProgramAccounts(
      ASSOCIATED_TOKEN_PROGRAM_ID,
      {
        filters: [
          {
            memcmp: {
              offset: 32, // owner offset in ATA
              bytes: walletAddress.toBase58(),
            },
          },
        ],
      }
    );

    for (const account of ataAccounts) {
      if (account.account.lamports > 0) {
        const isAlreadyIncluded = reclaimableAccounts.some(a =>
          a.address.equals(account.pubkey)
        );
        if (!isAlreadyIncluded) {
            const programId = account.account.owner.toBase58();
          reclaimableAccounts.push({
            address: account.pubkey,
            lamports: account.account.lamports,
            owner: account.account.owner,
            executable: account.account.executable,
            rentEpoch: account.account.rentEpoch ?? 0,
            type: 'associated-token',
            programId
          });
        }
      }
    }

    // 4. Detect Metaplex Metadata accounts
    // console.log('Scanning metadata accounts...');
    // const METAPLEX_PROGRAM_ID = new PublicKey(
    //   'metaqbxxUerdq28cj1RbAqWwTRiWLMsqLoea1PgurZ'
    // );

    // const metadataAccounts = await connection.getProgramAccounts(
    //   METAPLEX_PROGRAM_ID,
    //   {
    //     filters: [
    //       {
    //         memcmp: {
    //           offset: 0,
    //           bytes: walletAddress.toBase58(),
    //         },
    //       },
    //     ],
    //   }
    // );

    // for (const account of metadataAccounts) {
    //   if (account.account.lamports > 0) {
    //     const isAlreadyIncluded = reclaimableAccounts.some(a =>
    //       a.address.equals(account.pubkey)
    //     );
    //     if (!isAlreadyIncluded) {
    //       reclaimableAccounts.push({
    //         address: account.pubkey,
    //         lamports: account.account.lamports,
    //         owner: account.account.owner,
    //         executable: account.account.executable,
    //         rentEpoch: account.account.rentEpoch ?? 0,
    //         type: 'metadata',
    //       });
    //     }
    //   }
    //   if (reclaimableAccounts.length % 50 === 0) {
    //     await new Promise(resolve => setTimeout(resolve, 500));
    //   }
    // }

    // 5. Detect other program-owned accounts
    console.log('Scanning other accounts...');
    const allAccounts = await connection.getAccountInfo(walletAddress);
    
    if (allAccounts && allAccounts.lamports > 0) {
      const isAlreadyIncluded = reclaimableAccounts.some(a =>
        a.address.equals(walletAddress)
      );
      if (!isAlreadyIncluded && allAccounts.executable === false) {
        // Add logic to detect unused accounts created by other programs
      }
    }

    // 7 Scan all other programs owned by the wallet
    console.log('Scanning for accounts from all programs...');
      const allProgramAccounts = await connection.getProgramAccounts(walletAddress);

      for (const account of allProgramAccounts) {
        // Skip if already added from token program
        const isAlreadyIncluded = reclaimableAccounts.some(a =>
          a.address.equals(account.pubkey)
        );

        if (!isAlreadyIncluded && account.account.lamports > 0) {
          // Determine account type
          let type = 'unknown';
          const programId = account.account.owner.toBase58();

          if (programId === TOKEN_PROGRAM_ID.toBase58()) {
            type = 'token';
          } else if (programId === 'ATokenGPvbdGVqstVQmcLsNZAqeEbtQaMy63xtto2CXv') {
            type = 'associated-token';
          } else if (programId === 'metaqbxxUerdq28cj1RbAqWwTRiWLMsqLoea1PgurZ') {
            type = 'metadata';
          }

          reclaimableAccounts.push({
            address: account.pubkey,
            lamports: account.account.lamports,
            owner: account.account.owner,
            executable: account.account.executable,
            rentEpoch: account.account.rentEpoch ?? 0,
            type: "unknown",
            programId
          });
        }
      }

    return reclaimableAccounts;
  } catch (error) {
    console.error('Error detecting reclaimable accounts:', error);
    throw error;
  }
}

/**
 * Filters accounts to get only those with significant rent deposits
 * @param accounts - Array of detected accounts
 * @param minLamports - Minimum lamports to consider for reclaim (default: 2000)
 * @returns Filtered accounts
 */
export function filterSignificantAccounts(
  accounts: EmptyAccount[],
  minLamports: number = 2000
): EmptyAccount[] {
  return accounts.filter((account) => account.lamports >= minLamports);
}

/**
 * Calculates total SOL that can be reclaimed
 * @param accounts - Array of reclaimable accounts
 * @returns Total lamports and SOL
 */
export function calculateTotalReclaim(accounts: EmptyAccount[]): {
  totalLamports: number;
  totalSOL: number;
} {
  const totalLamports = accounts.reduce((sum, account) => sum + account.lamports, 0);
  return {
    totalLamports,
    totalSOL: totalLamports / 1e9, // Convert lamports to SOL
  };
}

/**
 * Example usage
 */
export async function exampleUsage() {
  const connection = new Connection("https://api.mainnet-beta.solana.com");
  const walletAddress = new PublicKey("YOUR_WALLET_ADDRESS_HERE");

  console.log("Scanning for reclaimable accounts...");
  const allAccounts = await detectReclaimableAccounts(
    connection,
    walletAddress
  );

  console.log(`Found ${allAccounts.length} empty accounts`);

  // Filter for accounts with meaningful rent
  const significantAccounts = filterSignificantAccounts(allAccounts);
  console.log(
    `${significantAccounts.length} accounts have significant rent deposits`
  );

  // Calculate total
  const { totalSOL } = calculateTotalReclaim(significantAccounts);
  console.log(`Total SOL to reclaim: ${totalSOL}`);

  // Log details
  significantAccounts.forEach((account) => {
    console.log(`Account: ${account.address.toBase58()}, Lamports: ${account.lamports}`);
  });
}