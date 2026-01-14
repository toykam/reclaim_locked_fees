"use client"

import "./globals.css";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { PhantomWalletAdapter } from '@solana/wallet-adapter-wallets';
import '@solana/wallet-adapter-react-ui/styles.css';
import '@solana/wallet-adapter-react-ui/styles.css';


export default function WalletProviders({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ConnectionProvider endpoint="https://api.mainnet-beta.solana.com">
        <WalletProvider wallets={[new PhantomWalletAdapter()]} autoConnect>
        <WalletModalProvider>
            {children}
        </WalletModalProvider>
        </WalletProvider>
    </ConnectionProvider>
  );
}
