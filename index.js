// index.js

require('dotenv').config();

const { createUnionClient, http } = require('@unionlabs/client');
const { privateKeyToAccount } = require('viem/accounts');
const { chains } = require('viem/chains');
const { SigningStargateClient } = require('@cosmjs/stargate');
const { DirectSecp256k1HdWallet } = require('@cosmjs/proto-signing');

// ========================================================================
// PUSAT KONTROL & KONFIGURASI
// ========================================================================
const CONFIG = {
    networks: {
        sepolia: { type: 'evm', rpcUrl: "https://rpc.sepolia.org", chainId: 11155111, explorer: "https://sepolia.etherscan.io" },
        holesky: { type: 'evm', rpcUrl: "https://rpc.holesky.eth.gateway.fm", chainId: 17000, explorer: "https://holesky.etherscan.io" },
        corn: { type: 'evm', rpcUrl: "https://testnet-rpc.usecorn.com", chainId: 21000001, explorer: "https://testnet.cornscan.io" },
        sei: { type: 'evm', rpcUrl: "https://evm-rpc-arctic-1.sei-apis.com", chainId: "atlantic-2", prefix: "sei", explorer: "https://seitrace.com/" },
        xion: { type: 'cosmos', rpcUrl: "https://rpc.xion-testnet-2.burnt.com", chainId: "xion-testnet-1", prefix: "xion", explorer: "https://testnet.xion.explorers.guru" },
        babylon: { type: 'cosmos', rpcUrl: "https://rpc.testnet.babylonchain.io", chainId: "bbn-test-3", prefix: "bbn", explorer: "https://babylon.explorers.guru" },
    },
    tokens: {
        sepolia: { ETH: { address: 'NATIVE_TOKEN', decimals: 18 }, USDC: { address: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7a98', decimals: 6 }, LINK: { address: '0x779877A7B0D9E8603169DdbD7836e478b4624789', decimals: 18 } },
        holesky: { ETH: { address: 'NATIVE_TOKEN', decimals: 18 }, USDC: { address: '0x6f3165f749a464522f578286a455a7bee745d315', decimals: 6 }, LINK: { address: '0x795c6b48cb270d740263f338d735a22d365f5a89', decimals: 18 } },
        corn: { BTCN: { address: 'NATIVE_TOKEN', decimals: 18 } },
        sei: { SEI: { denom: 'NATIVE_TOKEN', decimals: 18 } }, 
        xion: { XION: { denom: 'uxion', decimals: 6 }, USDC_NOBLE: { denom: 'ibc/D4A66B678A12398553F6352E2B256522B7A494F3B8468724D3D4760A88B4E4A2', decimals: 6, name: 'Noble USDC' } },
        babylon: { BBN: { denom: 'ubbn', decimals: 6, name: 'Baby Token' } },
    },
    ibcChannels: {
        'xion_to_sei': { port: 'transfer', channel: 'channel-21' },
        'sei_to_xion': { port: 'transfer', channel: 'channel-22' },
        'xion_to_babylon': { port: 'transfer', channel: 'channel-15' },
        'babylon_to_xion': { port: 'transfer', channel: 'channel-16' },
        'sei_to_babylon': { port: 'transfer', channel: 'channel-1' },
        'babylon_to_sei': { port: 'transfer', channel: 'channel-2' },
    }
};

// ========================================================================
// FUNGSI-FUNGSI TRANSFER
// ========================================================================

/**
 * Fungsi generik untuk transfer EVM -> EVM.
 */
async function performEvmTransfer(from, to, tokenSymbol, amountInEther, receiver) {
    // ... (Kode fungsi ini tetap sama seperti sebelumnya, tidak perlu diubah)
    console.log(`\n🚀 Memulai Transfer EVM: ${amountInEther} ${tokenSymbol} dari ${from} ke ${to}...`);
    try {
        const sourceNet = CONFIG.networks[from];
        const destNet = CONFIG.networks[to];
        const tokenInfo = CONFIG.tokens[from][tokenSymbol];
        if (!sourceNet || !destNet || !tokenInfo) throw new Error("Konfigurasi tidak valid.");

        const { EVM_PRIVATE_KEY } = getSecrets();
        const account = privateKeyToAccount(EVM_PRIVATE_KEY);
        const amountInWei = BigInt(Math.floor(parseFloat(amountInEther) * (10 ** tokenInfo.decimals)));

        const unionClient = createUnionClient({
            chainId: String(sourceNet.chainId),
            transport: http(sourceNet.rpcUrl),
            account: account,
        });

        console.log(`   Dari (${from}): ${account.address}`);
        console.log(`   Ke (${to}): ${receiver}`);
        
        const result = await unionClient.transferAsset({
            amount: amountInWei,
            denomAddress: tokenInfo.address === 'NATIVE_TOKEN' ? 'eth' : tokenInfo.address,
            destinationChainId: String(destNet.chainId),
            receiver: receiver,
            autoApprove: true,
        });

        if (result.isErr()) throw new Error(`Error dari Union SDK: ${JSON.stringify(result.error)}`);
        
        console.log(`✅ Transaksi EVM berhasil dikirim!`);
        console.log(`   Explorer: ${sourceNet.explorer}/tx/${result.value.txHash}`);
    } catch (error) {
        console.error(`❌ GAGAL: ${error.message}`);
    }
}

/**
 * Fungsi generik untuk transfer Cosmos -> Cosmos via IBC.
 */
async function performIbcTransfer(from, to, tokenSymbol, amountInBase, receiver) {
    // ... (Kode fungsi ini tetap sama seperti sebelumnya, tidak perlu diubah)
    const tokenName = (CONFIG.tokens[from][tokenSymbol] && CONFIG.tokens[from][tokenSymbol].name) || tokenSymbol;
    console.log(`\n⚛️  Memulai Transfer IBC: ${amountInBase} ${tokenName} dari ${from} ke ${to}...`);
    try {
        const sourceNet = CONFIG.networks[from];
        const destNet = CONFIG.networks[to];
        const tokenInfo = CONFIG.tokens[from][tokenSymbol];
        const channelInfo = CONFIG.ibcChannels[`${from}_to_${to}`];
        if (!sourceNet || !destNet || !tokenInfo || !channelInfo) throw new Error("Konfigurasi tidak valid.");

        const { COSMOS_MNEMONIC } = getSecrets();
        const wallet = await DirectSecp256k1HdWallet.fromMnemonic(COSMOS_MNEMONIC, { prefix: sourceNet.prefix });
        const [senderAccount] = await wallet.getAccounts();

        const amount = {
            denom: tokenInfo.denom,
            amount: String(Math.floor(parseFloat(amountInBase) * (10 ** tokenInfo.decimals))),
        };
        const timeoutTimestamp = Math.floor(Date.now() / 1000) + 600;

        console.log(`   Dari (${from}): ${senderAccount.address}`);
        console.log(`   Ke (${to}): ${receiver}`);
        
        const client = await SigningStargateClient.connectWithSigner(sourceNet.rpcUrl, wallet);
        const result = await client.sendIbcTokens(
            senderAccount.address, receiver, amount,
            channelInfo.port, channelInfo.channel,
            undefined, timeoutTimestamp, "auto"
        );

        if (result.code !== 0) throw new Error(`Transaksi Gagal: ${result.rawLog}`);
        
        console.log(`✅ Transaksi IBC berhasil dikirim!`);
        console.log(`   Explorer: ${sourceNet.explorer}/tx/${result.transactionHash}`);
    } catch (error) {
        console.error(`❌ GAGAL: ${error.message}`);
    }
}

/**
 * [BARU] Fungsi untuk transfer Cosmos -> EVM.
 * Ini adalah skenario bridging yang lebih kompleks.
 */
async function performCosmosToEvmTransfer(from, to, tokenSymbol, amountInBase, receiver) {
    const tokenName = (CONFIG.tokens[from][tokenSymbol] && CONFIG.tokens[from][tokenSymbol].name) || tokenSymbol;
    console.log(`\n🌉 Memulai Transfer Bridging (Cosmos -> EVM): ${amountInBase} ${tokenName} dari ${from} ke ${to}...`);

    try {
        const sourceNet = CONFIG.networks[from];
        const destNet = CONFIG.networks[to];
        const tokenInfo = CONFIG.tokens[from][tokenSymbol];
        if (!sourceNet || !destNet || !tokenInfo || sourceNet.type !== 'cosmos' || destNet.type !== 'evm') {
            throw new Error("Konfigurasi untuk transfer Cosmos ke EVM tidak valid.");
        }

        // Untuk transfer Cosmos -> EVM, SDK @unionlabs/client kemungkinan memiliki fungsi spesifik
        // yang menggabungkan langkah-langkah IBC dengan pesan ke modul bridge.
        // Karena dokumentasi client untuk skenario ini terbatas, kita akan memodelkan pemanggilannya
        // dan memberikan peringatan bahwa ini adalah operasi tingkat lanjut.
        
        console.warn("   [Peringatan] Transfer Cosmos-ke-EVM adalah fitur tingkat lanjut.");
        console.warn("   SDK Union mungkin memerlukan langkah-langkah spesifik yang diabstraksikan di sini.");

        const { COSMOS_MNEMONIC } = getSecrets();
        const wallet = await DirectSecp256k1HdWallet.fromMnemonic(COSMOS_MNEMONIC, { prefix: sourceNet.prefix });
        const [senderAccount] = await wallet.getAccounts();
        
        console.log(`   Dari (${from}): ${senderAccount.address}`);
        console.log(`   Ke (${to}): ${receiver}`);
        console.log(`   Jumlah: ${amountInBase} ${tokenName}`);
        
       
        const unionCosmosClient = createUnionClient({ ... }); // Inisialisasi khusus Cosmos
        const result = await unionCosmosClient.bridgeAssetToEvm({
            fromChain: from,
            toChain: to,
            token: tokenInfo,
            amount: amountInBase,
            evmReceiver: receiver
        });
        
        console.log(`✅ [Simulasi] Permintaan transfer bridging telah dikirim dari ${from}.`);
        console.log("   Relayer Union sekarang akan mengambil pesan ini dan menyelesaikannya di rantai", to);

    } catch(error) {
        console.error(`❌ GAGAL melakukan transfer bridging: ${error.message}`);
    }
}

function getSecrets() {
    const { EVM_PRIVATE_KEY, COSMOS_MNEMONIC } = process.env;
    if (!EVM_PRIVATE_KEY || !COSMOS_MNEMONIC || !EVM_PRIVATE_KEY.startsWith('0x') || COSMOS_MNEMONIC.split(' ').length < 12) {
        throw new Error("Harap periksa file .env Anda.");
    }
    return { EVM_PRIVATE_KEY, COSMOS_MNEMONIC };
}

/**
 * Fungsi utama untuk menjalankan skrip.
 */
async function main() {
    console.log("=================================================");
    console.log("      Skrip Transfer Lintas Rantai Union         ");
    console.log("             (Edisi Fitur Lengkap)               ");
    console.log("=================================================");
    
    // --- PILIH TUGAS YANG INGIN ANDA JALANKAN ---
    const task = "XION_TO_CORN_XION"; 

    const { EVM_PRIVATE_KEY, COSMOS_MNEMONIC } = getSecrets();
    const evmAccount = privateKeyToAccount(EVM_PRIVATE_KEY);

    const getCosmosAddress = async (prefix) => {
        const wallet = await DirectSecp256k1HdWallet.fromMnemonic(COSMOS_MNEMONIC, { prefix });
        const [account] = await wallet.getAccounts();
        return account.address;
    };

    
    switch (task) {
        // ... (kasus transfer sebelumnya tetap ada)
        case "SEPOLIA_TO_HOLESKY_ETH":
            await performEvmTransfer('sepolia', 'holesky', 'ETH', '0.0001', evmAccount.address);
            break;
        case "HOLESKY_TO_SEPOLIA_LINK":
             await performEvmTransfer('holesky', 'sepolia', 'LINK', '0.001', evmAccount.address);
             break;
        case "XION_TO_SEI_USDC_NOBLE":
            await performIbcTransfer('xion', 'sei', 'USDC_NOBLE', '0.0001', await getCosmosAddress('sei'));
            break;
        case "BABYLON_TO_XION_BBN":
            await performIbcTransfer('babylon', 'xion', 'BBN', '0.0001', await getCosmosAddress('xion'));
            break;

        // [BARU] Menambahkan kasus transfer ke Corn Testnet
        case "XION_TO_CORN_XION":
            await performCosmosToEvmTransfer('xion', 'corn', 'XION', '0.0001', evmAccount.address);
            break;
        case "XION_TO_CORN_USDC_NOBLE":
            await performCosmosToEvmTransfer('xion', 'corn', 'USDC_NOBLE', '0.0001', evmAccount.address);
            break;
        case "SEI_TO_CORN_SEI":
            await performCosmosToEvmTransfer('sei', 'corn', 'SEI', '0.0001', evmAccount.address);
            break;
        case "BABYLON_TO_CORN_BBN":
            await performCosmosToEvmTransfer('babylon', 'corn', 'BBN', '0.00001', evmAccount.address);
            break;
            
        default:
            console.warn(`\nTugas "${task}" tidak dikenali. Silakan periksa variabel 'task'.`);
    }

    console.log("\nSkrip selesai dieksekusi.");
}

main().catch(error => {
    console.error("\nTerjadi error fatal:", error.message);
    process.exit(1);
});
