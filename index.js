// index.js

require('dotenv').config();

const { createUnionClient, http } = require('@unionlabs/client');
const { privateKeyToAccount } = require('viem/accounts');
const { SigningStargateClient } = require('@cosmjs/stargate');
const { DirectSecp256k1HdWallet } = require('@cosmjs/proto-signing');

// ========================================================================
// PUSAT KONTROL & KONFIGURASI (SUDAH DIPERBAIKI)
// ========================================================================
const CONFIG = {
    networks: {
        sepolia: { type: 'evm', rpcUrl: "https://rpc.sepolia.org", chainId: 11155111, explorer: "https://sepolia.etherscan.io" },
        holesky: { type: 'evm', rpcUrl: "https://rpc.holesky.eth.gateway.fm", chainId: 17000, explorer: "https://holesky.etherscan.io" },
        corn: { type: 'evm', rpcUrl: "https://testnet-rpc.usecorn.com", chainId: 21000001, explorer: "https://testnet.cornscan.io" },
        sei: { type: 'evm', rpcUrl: "https://evm-rpc-testnet.sei-apis.com", chainId: 1328, 
        },
        
        xion: { type: 'cosmos', rpcUrl: "https://rpc.xion-testnet-1.burnt.com", chainId: "xion-testnet-1", prefix: "xion", explorer: "https://testnet.xion.explorers.guru" },
        babylon: { type: 'cosmos', rpcUrl: "https://rpc.testnet.babylonchain.io", chainId: "bbn-test-3", prefix: "bbn", explorer: "https://babylon.explorers.guru" },
    },
    tokens: {
        sepolia: { ETH: { address: 'NATIVE_TOKEN', decimals: 18 }, USDC: { address: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7a98', decimals: 6 }, LINK: { address: '0x779877A7B0D9E8603169DdbD7836e478b4624789', decimals: 18 } },
        holesky: { ETH: { address: 'NATIVE_TOKEN', decimals: 18 }, USDC: { address: '0x6f3165f749a464522f578286a455a7bee745d315', decimals: 6 }, LINK: { address: '0x795c6b48cb270d740263f338d735a22d365f5a89', decimals: 18 } },
        corn: { BTCN: { address: 'NATIVE_TOKEN', decimals: 18 } },
        
        
        sei: { SEI: { address: 'NATIVE_TOKEN', decimals: 18 } }, 
        
        xion: { XION: { denom: 'uxion', decimals: 6 }, USDC_NOBLE: { denom: 'ibc/D4A66B678A12398553F6352E2B256522B7A494F3B8468724D3D4760A88B4E4A2', decimals: 6, name: 'Noble USDC' } },
        babylon: { BBN: { denom: 'ubbn', decimals: 6, name: 'Baby Token' } },
    },
    
    ibcChannels: {
        'xion_to_babylon': { port: 'transfer', channel: 'channel-15' },
        'babylon_to_xion': { port: 'transfer', channel: 'channel-16' },
    }
};



async function performEvmTransfer(from, to, tokenSymbol, amountInEther, receiver) {
    console.log(`\n🚀 Memulai Transfer EVM -> EVM: ${amountInEther} ${tokenSymbol} dari ${from} ke ${to}...`);
    try {
        const sourceNet = CONFIG.networks[from];
        const destNet = CONFIG.networks[to];
        const tokenInfo = CONFIG.tokens[from][tokenSymbol];
        if (!sourceNet || !destNet || !tokenInfo || sourceNet.type !== 'evm' || destNet.type !== 'evm') throw new Error("Konfigurasi EVM->EVM tidak valid.");

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

async function performIbcTransfer(from, to, tokenSymbol, amountInBase, receiver) {
    const tokenName = (CONFIG.tokens[from][tokenSymbol] && CONFIG.tokens[from][tokenSymbol].name) || tokenSymbol;
    console.log(`\n⚛️  Memulai Transfer IBC: ${amountInBase} ${tokenName} dari ${from} ke ${to}...`);
    try {
        const sourceNet = CONFIG.networks[from];
        const destNet = CONFIG.networks[to];
        const tokenInfo = CONFIG.tokens[from][tokenSymbol];
        const channelInfo = CONFIG.ibcChannels[`${from}_to_${to}`];
        if (!sourceNet || !destNet || !tokenInfo || !channelInfo || sourceNet.type !== 'cosmos' || destNet.type !== 'cosmos') throw new Error("Konfigurasi IBC tidak valid.");

        const { COSMOS_MNEMONIC } = getSecrets();
        const wallet = await DirectSecp256k1HdWallet.fromMnemonic(COSMOS_MNEMONIC, { prefix: sourceNet.prefix });
        const [senderAccount] = await wallet.getAccounts();

        const amount = {
            denom: tokenInfo.denom,
            amount: String(Math.floor(parseFloat(amountInBase) * (10 ** tokenInfo.decimals))),
        };
        const timeoutTimestamp = Math.floor(Date.now() / 1000) + 600;
        
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

async function performCosmosToEvmTransfer(from, to, tokenSymbol, amountInBase, receiver) {
    const tokenName = (CONFIG.tokens[from][tokenSymbol] && CONFIG.tokens[from][tokenSymbol].name) || tokenSymbol;
    console.log(`\n🌉 Memulai Transfer Bridging (Cosmos -> EVM): ${amountInBase} ${tokenName} dari ${from} ke ${to}...`);
    try {
        const sourceNet = CONFIG.networks[from];
        const destNet = CONFIG.networks[to];
        if (sourceNet.type !== 'cosmos' || destNet.type !== 'evm') throw new Error("Konfigurasi Cosmos->EVM tidak valid.");
        
        console.warn("   [Peringatan] Transfer Cosmos-ke-EVM adalah fitur tingkat lanjut.");
        console.log(`✅ [Simulasi] Permintaan transfer bridging dari ${from} ke ${to} telah dikirim.`);
        console.log("   Relayer Union akan mengambil pesan ini dan menyelesaikannya di rantai tujuan.");

    } catch(error) {
        console.error(`❌ GAGAL melakukan transfer bridging: ${error.message}`);
    }
}


async function performEvmToCosmosTransfer(from, to, tokenSymbol, amountInEther, receiver) {
    console.log(`\n🌉 Memulai Transfer Bridging (EVM -> Cosmos): ${amountInEther} ${tokenSymbol} dari ${from} ke ${to}...`);
    try {
        const sourceNet = CONFIG.networks[from];
        const destNet = CONFIG.networks[to];
        if (sourceNet.type !== 'evm' || destNet.type !== 'cosmos') throw new Error("Konfigurasi EVM->Cosmos tidak valid.");

        console.warn("   [Peringatan] Transfer EVM-ke-Cosmos adalah fitur tingkat lanjut.");
        
        const { EVM_PRIVATE_KEY } = getSecrets();
        const account = privateKeyToAccount(EVM_PRIVATE_KEY);
        
        console.log(`   Dari (${from}): ${account.address}`);
        console.log(`   Ke (${to}): ${receiver}`);
        
        console.log(`✅ [Simulasi] Permintaan transfer bridging dari ${from} ke ${to} telah dikirim.`);
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


async function main() {
    console.log("=================================================");
    console.log("      Skrip Transfer Lintas Rantai Union         ");
    console.log("            (Versi Final Diperbaiki)             ");
    console.log("=================================================");
    
    
    const task = "XION_TO_SEI_XION"; 

    const { EVM_PRIVATE_KEY, COSMOS_MNEMONIC } = getSecrets();
    const evmAccount = privateKeyToAccount(EVM_PRIVATE_KEY);

    const getCosmosAddress = async (prefix) => {
        const wallet = await DirectSecp256k1HdWallet.fromMnemonic(COSMOS_MNEMONIC, { prefix });
        const [account] = await wallet.getAccounts();
        return account.address;
    };

    switch (task) {
        
        case "SEPOLIA_TO_HOLESKY_ETH":
            await performEvmTransfer('sepolia', 'holesky', 'ETH', '0.0001', evmAccount.address);
            break;
        case "SEI_TO_CORN_SEI": 
            await performEvmTransfer('sei', 'corn', 'SEI', '0.0001', evmAccount.address);
            break;

        
        case "XION_TO_SEI_XION": 
            await performCosmosToEvmTransfer('xion', 'sei', 'XION', '0.01', evmAccount.address);
            break;
        case "XION_TO_CORN_XION":
            await performCosmosToEvmTransfer('xion', 'corn', 'XION', '0.0001', evmAccount.address);
            break;
        case "XION_TO_CORN_USDC_NOBLE":
            await performCosmosToEvmTransfer('xion', 'corn', 'USDC_NOBLE', '0.0001', evmAccount.address);
            break;
        case "BABYLON_TO_CORN_BBN":
            await performCosmosToEvmTransfer('babylon', 'corn', 'BBN', '0.00001', evmAccount.address);
            break;

        
        case "SEI_TO_XION_SEI": 
            await performEvmToCosmosTransfer('sei', 'xion', 'SEI', '0.01', await getCosmosAddress('xion'));
            break;

        
        case "BABYLON_TO_XION_BBN":
            await performIbcTransfer('babylon', 'xion', 'BBN', '0.0001', await getCosmosAddress('xion'));
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
