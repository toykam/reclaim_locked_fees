import { NextRequest, NextResponse } from "next/server";
import { Connection, PublicKey } from "@solana/web3.js";
import { detectReclaimableAccounts } from "@/lib/detection-logic";


export async function POST(req: NextRequest) {
    try {
        const connection = new Connection(process.env.SOLANA_RPC_URL!, { commitment: "confirmed" });
        const body = await req.json();
        const { pubkey } = body;

        if (!pubkey) return NextResponse.json({ error: "Missing pubkey" }, { status: 400 });

        const owner = new PublicKey(pubkey);

        // Fetch all SPL token accounts for the owner
        const accounts = await detectReclaimableAccounts(
            connection,
            owner
        )

        return NextResponse.json({ accounts: accounts });
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
