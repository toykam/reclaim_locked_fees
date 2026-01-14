"use client"

import { useState, useEffect } from 'react';
import { Connection, PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js';
import { createCloseAccountInstruction } from '@solana/spl-token';
import { Wallet, AlertCircle, Loader, CheckCircle, Send } from 'lucide-react';
import { detectReclaimableAccounts } from '@/lib/detection-logic';
import { toast } from 'sonner';

interface EmptyAccount {
  address: PublicKey;
  lamports: number;
  owner: PublicKey;
  executable: boolean;
  rentEpoch: number;
  type: string;
  programId: string
}

export default function RentReclaimDApp() {
  const [connected, setConnected] = useState(false);
  const [wallet, setWallet] = useState<PublicKey | null>(null);
  const [publicAddress, setPublicAddress] = useState('');
  const [addressInput, setAddressInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [accounts, setAccounts] = useState<EmptyAccount[]>([]);
  const [selectedAccounts, setSelectedAccounts] = useState<Set<string>>(new Set());
  const [totalSOL, setTotalSOL] = useState(0);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [solPrice, setSolPrice] = useState(0);
  const [connection] = useState(
    new Connection(
      process.env.NEXT_PUBLIC_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com'
    )
  );

  const checkWalletMatch = () => {
    if (!wallet || !publicAddress) return null;
    return wallet.toString() === publicAddress;
  };

  const walletMatches = checkWalletMatch();
  

  const checkWalletConnection = async () => {
    if (window.solana) {
      try {
        const resp = await window.solana.connect({ onlyIfTrusted: true });
        setWallet(resp.publicKey);
        setConnected(true);
        setPublicAddress(wallet?.toString() ?? "")
      } catch (err) {
        setConnected(false);
      }
    }
  };

  const fetchSolPrice = async () => {
    try {
      const response = await fetch(
        'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd'
      );
      const data = await response.json();
      setSolPrice(data.solana.usd);
    } catch (err) {
      console.error('Error fetching SOL price:', err);
      setSolPrice(0);
    }
  };

  useEffect(() => {
    checkWalletConnection();
    fetchSolPrice()
  }, []);

  const connectWallet = async () => {
    if (!window.solana) {
      setError('Phantom wallet not found. Please install it.');
      return;
    }
    try {
      const resp = await window.solana.connect();
      setWallet(resp.publicKey);
      setConnected(true);
      setError('');
    } catch (err) {
      setError('Failed to connect wallet');
    }
  };

  const disconnectWallet = () => {
    setWallet(null);
    setConnected(false);
  };

  const isValidSolanaAddress = (address: string): boolean => {
    try {
      const pubkey = new PublicKey(address.trim());
      return pubkey.toString().length === 44;
    } catch (err) {
      return false;
    }
  };

  const handleAddressSubmit = () => {
    if (!isValidSolanaAddress(addressInput)) {
      setError('Invalid Solana address. Please check and try again.');
      return;
    }
    try {
      const pubkey = new PublicKey(addressInput.trim());
      setPublicAddress(pubkey.toString());
      setAddressInput('');
      setError('');
    } catch (err) {
      toast.error('Invalid Solana address');
    }
  };

  const clearAddress = () => {
    setPublicAddress('');
    setAccounts([]);
    setSelectedAccounts(new Set());
    setTotalSOL(0);
    setStatus('');
  };

  const scanAccounts = async () => {
    if (!publicAddress) return;
    setScanning(true);
    setError('');
    setStatus('Scanning wallet for empty token accounts...');

    try {
      // const walletPubkey = new PublicKey(publicAddress);
      const response = await fetch("/api/scan-address", {
        method: "POST",
        body: JSON.stringify({
          "pubkey": publicAddress
        })
      })

      const data = await response.json()

      const reclaimable = data.accounts as EmptyAccount[]

      console.log("Reclaimables: ", reclaimable)

      setAccounts(reclaimable);
      const total = reclaimable.reduce((sum, a) => sum + a.lamports, 0) / 1e9;
      setTotalSOL(total);
      setStatus(`Found ${reclaimable.length} empty accounts with ${total.toFixed(4)} SOL locked`);
    } catch (err: any) {
      setError('Error scanning accounts: ' + err.message);
      setStatus('');
    } finally {
      setScanning(false);
    }
  };

  const toggleSelectAccount = (address: string) => {
    const newSelected = new Set(selectedAccounts);
    if (newSelected.has(address)) {
      newSelected.delete(address);
    } else {
      newSelected.add(address);
    }
    setSelectedAccounts(newSelected);
  };

  const selectAll = () => {
    setSelectedAccounts(new Set(accounts.map((a) => a.address.toString())));
  };

  const deselectAll = () => {
    setSelectedAccounts(new Set());
  };


  const reclaimSOL = async () => {
    if (!wallet || !connected) {
      setError('Please connect your wallet first to claim SOL');
      return;
    }

    if (wallet.toString() !== publicAddress) {
      setError('Connected wallet must match the scanned address to claim. Please connect the correct wallet.');
      return;
    }

    if (selectedAccounts.size === 0) {
      setError('Please select at least one account');
      return;
    }

    setLoading(true);
    setError('');
    setStatus('Preparing transaction...');

    try {
      const selectedAccountPubkeys = accounts.filter((a) =>
        selectedAccounts.has(a.address.toString())
      );

      const totalLamports = selectedAccountPubkeys.reduce((sum, a) => sum + a.lamports, 0);
      const feeLamports = Math.floor(totalLamports * 0.15);
      const FEE_RECIPIENT = new PublicKey(process.env.NEXT_PUBLIC_FEE_RECIPIENT ?? "");

      const instructions = [];
      for (const account of selectedAccountPubkeys) {
        const instruction = createCloseAccountInstruction(
          account.address,
          wallet,
          wallet
        );
        instructions.push(instruction);
      }

      const feeBuffer = Buffer.alloc(8);
      feeBuffer.writeUInt32LE(feeLamports >>> 0, 0);
      feeBuffer.writeUInt32LE(Math.floor(feeLamports / 0x100000000), 4);
      
      instructions.push({
        keys: [
          { pubkey: wallet, isSigner: true, isWritable: true },
          { pubkey: FEE_RECIPIENT, isSigner: false, isWritable: true },
        ],
        programId: new PublicKey('11111111111111111111111111111111'),
        data: Buffer.concat([Buffer.from([2, 0, 0, 0]), feeBuffer]),
      } as any);

      const { blockhash } = await connection.getLatestBlockhash();

      const transaction = new Transaction({
        recentBlockhash: blockhash,
        feePayer: wallet,
      });

      transaction.add(...instructions);

      setStatus('Waiting for wallet signature...');
      const signedTx = await window.solana.signTransaction(transaction);
      
      setStatus('Sending transaction...');
      const signature = await connection.sendRawTransaction(signedTx.serialize(), {
        skipPreflight: false,
        maxRetries: 5,
      });

      setStatus('Confirming transaction...');
      
      let confirmed = false;
      
      for (let i = 0; i < 60; i++) {
        try {
          const status = await connection.getSignatureStatus(signature);
          if (status && status.value) {
            const confirmationStatus = status.value.confirmationStatus;
            if (confirmationStatus === 'confirmed' || confirmationStatus === 'finalized') {
              confirmed = true;
              break;
            }
          }
        } catch (err) {
          console.log('Polling transaction status...');
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      const selectedTotal = totalLamports / 1e9;
      const feeTotal = feeLamports / 1e9;
      const netTotal = (totalLamports - feeLamports) / 1e9;
      
      if (confirmed) {
        setStatus(`✅ Success! Reclaimed ${selectedTotal.toFixed(4)} SOL (Net: ${netTotal.toFixed(4)} SOL). Fee: ${feeTotal.toFixed(4)} SOL. Tx: ${signature.slice(0, 20)}...`);
      } else {
        setStatus(`✅ Transaction submitted! Tx: ${signature.slice(0, 20)}...\nCheck Solscan for final confirmation status.`);
      }
      
      setSelectedAccounts(new Set());
      setAccounts([]);
      setTotalSOL(0);
    } catch (err) {
      setError('Transaction failed: ' + (err as Error).message);
      setStatus('');
    } finally {
      setLoading(false);
    }
  };

  const selectedTotal = accounts
    .filter((a) => selectedAccounts.has(a.address.toString()))
    .reduce((sum, a) => sum + a.lamports, 0) / 1e9;

  const feePercentage = 0.15;
  const feeAmount = selectedTotal * feePercentage;
  const netAmount = selectedTotal - feeAmount;

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(wallet?.toString() ?? "");
      toast.success('Address copied!');
      // setIsCopied(true);
      // setTimeout(() => setIsCopied(false), 2000); // Reset copied state after 2 seconds
    } catch (err) {
      console.error("Failed to copy to clipboard:", err);
    }
  };


  const loadConnectedWallet = () => {
    if (wallet) {
      setPublicAddress(wallet.toString());
      setError('');
    }
  };

  return (
     <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 text-white p-4 sm:p-6">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-8">
          <div className="flex items-center gap-3">
            <Wallet className="w-6 sm:w-8 h-6 sm:h-8 text-purple-400 flex-shrink-0" />
            <h1 className="text-2xl sm:text-3xl font-bold">Solana Rent Reclaim</h1>
          </div>
          {connected ? (
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 w-full sm:w-auto">
              <div className="text-sm flex-1 sm:flex-none">
                <p className="text-gray-400">Connected:</p>
                <p className="font-mono text-purple-300 text-xs sm:text-sm break-all">
                  {wallet?.toString().slice(0, 8)}...{wallet?.toString().slice(-8)}
                </p>
              </div>
              <button
                onClick={() => {
                  disconnectWallet();
                  clearAddress();
                }}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 rounded-lg font-semibold transition text-sm sm:text-base whitespace-nowrap"
              >
                Disconnect
              </button>
            </div>
          ) : (
            <button
              onClick={connectWallet}
              className="px-6 py-3 bg-purple-600 hover:bg-purple-700 rounded-lg font-semibold transition flex items-center justify-center gap-2 w-full sm:w-auto"
            >
              <Wallet className="w-5 h-5" />
              <span className="text-sm sm:text-base">Connect Wallet</span>
            </button>
          )}
        </div>

        {/* Address Input Section */}
        <div className="bg-slate-800 rounded-lg p-4 sm:p-6 border border-slate-700 mb-6">
          <label className="block text-sm font-semibold text-gray-300 mb-3">
            Enter Solana Address to Scan
          </label>
          <div className="flex flex-col sm:flex-row gap-2 mb-3">
            <input
              type="text"
              value={addressInput}
              onChange={(e) => setAddressInput(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleAddressSubmit()}
              placeholder="Enter a Solana public address"
              className="flex-1 px-4 py-3 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-purple-500 text-sm"
            />
            <button
              onClick={handleAddressSubmit}
              disabled={!addressInput.trim()}
              className="px-6 py-3 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 rounded-lg font-semibold transition text-sm whitespace-nowrap"
            >
              Load Address
            </button>
          </div>
          
          {connected && wallet && (
            <button
              onClick={loadConnectedWallet}
              className="w-full px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm font-semibold transition text-purple-300"
            >
              Use Connected Wallet ({wallet.toString().slice(0, 8)}...{wallet.toString().slice(-8)})
            </button>
          )}
        </div>

        {/* Current Address Display */}
        {publicAddress && (
          <div className="bg-slate-800 rounded-lg p-4 border border-purple-500 mb-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-400">Scanning Address:</p>
                <p className="font-mono text-purple-300 text-xs sm:text-sm break-all">{publicAddress}</p>
              </div>
              <div className="flex gap-2 flex-shrink-0">
                <button
                  onClick={() => copyToClipboard()}
                  className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm font-semibold transition whitespace-nowrap"
                  title="Copy address"
                >
                  📋 Copy
                </button>
                <button
                  onClick={clearAddress}
                  className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm font-semibold transition whitespace-nowrap"
                >
                  Clear
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Main Content */}
        {!publicAddress ? (
          <div className="bg-slate-800 rounded-lg p-8 sm:p-12 text-center">
            <Wallet className="w-12 sm:w-16 h-12 sm:h-16 mx-auto mb-4 text-purple-400 opacity-50" />
            <h2 className="text-xl sm:text-2xl font-bold mb-2">Enter an Address to Start</h2>
            <p className="text-sm sm:text-base text-gray-400">Enter any Solana address above to scan for recoverable rent fees. You'll only need to connect your wallet when you're ready to claim.</p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Scan Button */}
            <button
              onClick={scanAccounts}
              disabled={scanning}
              className="w-full py-3 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 rounded-lg font-semibold transition flex items-center justify-center gap-2"
            >
              {scanning ? (
                <>
                  <Loader className="w-5 h-5 animate-spin" />
                  Scanning...
                </>
              ) : (
                <>
                  <Send className="w-5 h-5" />
                  Scan for Accounts
                </>
              )}
            </button>

            {/* Status Messages */}
            {error && (
              <div className="bg-red-900 border border-red-700 rounded-lg p-4 flex gap-3">
                <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                <p className="text-sm">{error}</p>
              </div>
            )}

            {status && (
              <div className="bg-blue-900 border border-blue-700 rounded-lg p-4 flex gap-3">
                <CheckCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                <p className="text-sm">{status}</p>
              </div>
            )}

            {/* Wallet Mismatch Warning */}
            {connected && publicAddress && !walletMatches && (
              <div className="bg-yellow-900 border border-yellow-700 rounded-lg p-4 flex gap-3">
                <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5 text-yellow-400" />
                <div>
                  <p className="font-semibold text-yellow-200 mb-2 text-sm">Wallet Mismatch</p>
                  <p className="text-xs text-yellow-100 mb-3">
                    You are scanning {publicAddress.slice(0, 8)}...{publicAddress.slice(-8)} but connected to {wallet?.toString().slice(0, 8)}...{wallet?.toString().slice(-8)}
                  </p>
                  <p className="text-xs text-yellow-100">
                    To claim SOL, please connect the wallet that matches the scanned address.
                  </p>
                </div>
              </div>
            )}

            {/* Results */}
            {accounts.length > 0 && (
              <div className="space-y-4">
                {/* Summary */}
                <div className="bg-slate-800 rounded-lg p-4 sm:p-6 border border-purple-500 space-y-4">
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                    <div>
                      <p className="text-gray-400 text-xs sm:text-sm">Total Recoverable</p>
                      <p className="text-xl sm:text-2xl font-bold text-purple-300">{totalSOL.toFixed(4)} SOL</p>
                      {solPrice > 0 && (
                        <p className="text-xs text-gray-500 mt-1">${(totalSOL * solPrice).toFixed(2)} USD</p>
                      )}
                    </div>
                    <div>
                      <p className="text-gray-400 text-xs sm:text-sm">Empty Accounts</p>
                      <p className="text-xl sm:text-2xl font-bold">{accounts.length}</p>
                    </div>
                    <div>
                      <p className="text-gray-400 text-xs sm:text-sm">Selected</p>
                      <p className="text-xl sm:text-2xl font-bold text-green-400">{selectedAccounts.size}</p>
                    </div>
                  </div>

                  {/* Fee Breakdown */}
                  {selectedTotal > 0 && (
                    <div className="border-t border-slate-700 pt-4 space-y-2">
                      <div className="flex justify-between items-start sm:items-center text-sm">
                        <p className="text-gray-400">Selected Amount:</p>
                        <div className="text-right">
                          <p className="font-semibold">{selectedTotal.toFixed(4)} SOL</p>
                          {solPrice > 0 && (
                            <p className="text-xs text-gray-500">${(selectedTotal * solPrice).toFixed(2)}</p>
                          )}
                        </div>
                      </div>
                      <div className="flex justify-between items-start sm:items-center text-sm">
                        <p className="text-gray-400">Service Fee (15%):</p>
                        <div className="text-right">
                          <p className="font-semibold text-orange-400">-{feeAmount.toFixed(4)} SOL</p>
                          {solPrice > 0 && (
                            <p className="text-xs text-gray-500">-${(feeAmount * solPrice).toFixed(2)}</p>
                          )}
                        </div>
                      </div>
                      <div className="flex justify-between items-start sm:items-center border-t border-slate-600 pt-2">
                        <p className="text-gray-300 font-semibold text-sm">You Receive:</p>
                        <div className="text-right">
                          <p className="font-bold text-green-400">{netAmount.toFixed(4)} SOL</p>
                          {solPrice > 0 && (
                            <p className="text-xs text-green-400">${(netAmount * solPrice).toFixed(2)}</p>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Fee Notice */}
                  <div className="bg-orange-900 border border-orange-700 rounded p-3">
                    <p className="text-xs sm:text-sm text-orange-200">
                      <span className="font-semibold">Note:</span> A 15% service fee will be deducted from your reclaimed SOL. This helps us maintain and improve the service.
                    </p>
                  </div>
                </div>

                {/* Select Controls */}
                <div className="flex flex-col sm:flex-row gap-2">
                  <button
                    onClick={selectAll}
                    className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm font-semibold transition flex-1"
                  >
                    Select All
                  </button>
                  <button
                    onClick={deselectAll}
                    className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm font-semibold transition flex-1"
                  >
                    Deselect All
                  </button>
                </div>

                {/* Account List */}
                <div className="bg-slate-800 rounded-lg overflow-hidden border border-slate-700">
                  <div className="overflow-y-auto max-h-96">
                    {accounts.map((account) => {
                      const typeColors: Record<string, string> = {
                        token: 'bg-blue-900 text-blue-200',
                        nft: 'bg-purple-900 text-purple-200',
                        'associated-token': 'bg-cyan-900 text-cyan-200',
                        metadata: 'bg-pink-900 text-pink-200',
                        unknown: 'bg-red-900 text-red-200',
                      };

                      const typeLabels: Record<string, string> = {
                        token: 'Token',
                        nft: 'NFT',
                        'associated-token': 'ATA',
                        metadata: 'Metadata',
                        unknown: 'Unknown',
                      };

                      const color = typeColors[account.type] || typeColors.unknown;
                      const label = typeLabels[account.type] || 'Unknown';
                      const isUnknown = account.type === 'unknown';

                      return (
                        <div
                          key={account.address.toString()}
                          className={`p-4 border-b border-slate-700 last:border-b-0 hover:bg-slate-700 transition cursor-pointer flex items-start gap-3 ${
                            isUnknown ? 'opacity-75' : ''
                          }`}
                          onClick={() => toggleSelectAccount(account.address.toString())}
                          title={isUnknown ? `Program: ${account.programId}` : ''}
                        >
                          <input
                            type="checkbox"
                            checked={selectedAccounts.has(account.address.toString())}
                            onChange={() => {}}
                            className="w-5 h-5 rounded cursor-pointer flex-shrink-0 mt-1"
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2 mb-1">
                              <p className="font-mono text-xs sm:text-sm text-gray-400 truncate">
                                {account.address.toString()}
                              </p>
                              {isUnknown && (
                                <span className="text-xs bg-red-900 text-red-200 px-2 py-1 rounded whitespace-nowrap w-fit">
                                  ⚠️ Unknown
                                </span>
                              )}
                            </div>
                            <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2 text-xs text-gray-500">
                              <span className={`px-2 py-1 rounded text-xs font-semibold ${color} w-fit`}>
                                {label}
                              </span>
                              {isUnknown && (
                                <span className="font-mono text-gray-600 truncate">
                                  {account.programId.slice(0, 8)}...
                                </span>
                              )}
                              <span className="text-gray-600">
                                {(account.lamports / 1e9).toFixed(6)} SOL
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Reclaim Button */}
                <button
                  onClick={reclaimSOL}
                  disabled={loading || selectedAccounts.size === 0 || !connected || !walletMatches}
                  className="w-full py-3 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 rounded-lg font-semibold transition flex items-center justify-center gap-2"
                  title={!connected ? 'Connect wallet to claim' : !walletMatches ? 'Connected wallet must match scanned address' : selectedAccounts.size === 0 ? 'Select accounts to claim' : ''}
                >
                  {loading ? (
                    <>
                      <Loader className="w-5 h-5 animate-spin" />
                      Processing...
                    </>
                  ) : !connected ? (
                    <>
                      <AlertCircle className="w-5 h-5" />
                      Connect Wallet to Claim
                    </>
                  ) : (
                    <>
                      <CheckCircle className="w-5 h-5" />
                      Reclaim {selectedTotal > 0 ? selectedTotal.toFixed(4) : '0'} SOL (Net: {netAmount.toFixed(4)} SOL)
                    </>
                  )}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}