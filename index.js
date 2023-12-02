// https://docs.solana.com/developing/lookup-tables
// How to create an address lookup table
const web3 = require("@solana/web3.js");
const bs58 = require('bs58');

const secretKey = bs58.decode("YOUR PRIVATE KEY");
const payer = web3.Keypair.fromSecretKey(secretKey);
console.log('publickey:', payer.publicKey.toString());

const connection = new web3.Connection(web3.clusterApiUrl("devnet"));

async function createAndSendV0Tx(arrayOfInstructions) {
    // Assumptions:
    // - `arrayOfInstructions` has been created as an `array` of `TransactionInstruction`
    // - we are using the `lookupTableAccount` obtained above

    let latestBlockhash = await connection.getLatestBlockhash('finalized');
    console.log("   ✅ - Fetched latest blockhash. Last valid height:", latestBlockhash.lastValidBlockHeight);

    // construct a v0 compatible transaction `Message`
    const messageV0 = new web3.TransactionMessage({
        payerKey: payer.publicKey,
        recentBlockhash: latestBlockhash.blockhash,
        instructions: arrayOfInstructions, // note this is an array of instructions
    }).compileToV0Message(); // [lookupTableAccount]
    console.log("   ✅ - Compiled transaction message");

    // create a v0 transaction from the v0 message
    const transactionV0 = new web3.VersionedTransaction(messageV0);

    // sign the v0 transaction using the file system wallet we created named `payer`
    transactionV0.sign([payer]);
    console.log("   ✅ - Transaction Signed");

    // send and confirm the transaction
    // (NOTE: There is NOT an array of Signers here; see the note below...)
    // console.log('transaction:', transactionV0)
    const txid = await connection.sendTransaction(transactionV0, connection)
    await connection.confirmTransaction({
        signature: txid,
        blockhash: latestBlockhash.blockhash,
        lastValidBlockHeight: latestBlockhash.lastValidBlockHeight
    })

    // const txid = await web3.sendAndConfirmTransaction(connection, transactionV0);

    console.log('🎉 Transaction succesfully confirmed!', '\n', `https://explorer.solana.com/tx/${txid}?cluster=devnet`);
}

async function createALTs() {
    const slot = await connection.getSlot();
    console.log('slot:', slot);

    const [lookupTableInst, lookupTableAddress] =
        web3.AddressLookupTableProgram.createLookupTable({
            authority: payer.publicKey,
            payer: payer.publicKey,
            recentSlot: slot,
        });


    console.log("lookup table address:", lookupTableAddress.toBase58());

    // To create the Address Lookup Table on chain:
    // send the `lookupTableInst` instruction in a transaction

    await createAndSendV0Tx([lookupTableInst])
    console.log("   ✅ - Create lookup table");

    return lookupTableAddress
}

async function addAddress(lookupTableAddress, addresses) {
    // add addresses to the `lookupTableAddress` table via an `extend` instruction
    const extendInstruction = web3.AddressLookupTableProgram.extendLookupTable({
        payer: payer.publicKey,
        authority: payer.publicKey,
        lookupTable: lookupTableAddress,
        addresses: addresses,
    });

    // Send this `extendInstruction` in a transaction to the cluster
    // to insert the listing of `addresses` into your lookup table with address `lookupTableAddress`
    // console.log('extendInstruction:', extendInstruction)

    await createAndSendV0Tx([extendInstruction]);
    console.log(`Lookup Table Entries: `, `https://explorer.solana.com/address/${lookupTableAddress.toString()}/entries?cluster=devnet`)
}

async function fetchALTs(lookupTableAddress) {
    // Fetch an Address Lookup Table
    // define the `PublicKey` of the lookup table to fetch
    // const lookupTableAddress = new web3.PublicKey("");

    // get the table from the cluster
    const lookupTableAccount = await connection
        .getAddressLookupTable(lookupTableAddress)
        .then((res) => res.value);

    console.log('lookupTableAccount:', lookupTableAccount)

    // `lookupTableAccount` will now be a `AddressLookupTableAccount` object

    console.log("Table address from cluster:", lookupTableAccount.key.toBase58());

    // loop through and parse all the addresses stored in the table
    for (let i = 0; i < lookupTableAccount.state.addresses.length; i++) {
        const address = lookupTableAccount.state.addresses[i];
        console.log(i, address);
    }

    return lookupTableAccount
}

async function compareTxSize(lookupTableAddress) {
    // Step 1 - Fetch the lookup table
    const lookupTable = (await connection.getAddressLookupTable(lookupTableAddress)).value;
    if (!lookupTable) return;
    console.log("   ✅ - Fetched lookup table:", lookupTable.key.toString());

    // Step 2 - Generate an array of Solana transfer instruction to each address in our lookup table
    const txInstructions = []
    for (let i = 0; i < lookupTable.state.addresses.length; i++) {
        const address = lookupTable.state.addresses[i];
        txInstructions.push(
            web3.SystemProgram.transfer({
                fromPubkey: payer.publicKey,
                toPubkey: address,
                lamports: 0.01 * 100000000,
            })
        )
    }

    // Step 3 - Fetch the latest Blockhash
    let latestBlockhash = await connection.getLatestBlockhash('finalized');
    console.log("   ✅ - Fetched latest blockhash. Last valid height:", latestBlockhash.lastValidBlockHeight);

    // Step 4 - Generate and sign a transaction that uses a lookup table
    const messageWithLookupTable = new web3.TransactionMessage({
        payerKey: payer.publicKey,
        recentBlockhash: latestBlockhash.blockhash,
        instructions: txInstructions
    }).compileToV0Message([lookupTable]); // 👈 NOTE: We DO include the lookup table
    const transactionWithLookupTable = new web3.VersionedTransaction(messageWithLookupTable);
    transactionWithLookupTable.sign([payer]);

    // Step 5 - Generate and sign a transaction that DOES NOT use a lookup table
    const messageWithoutLookupTable = new web3.TransactionMessage({
        payerKey: payer.publicKey,
        recentBlockhash: latestBlockhash.blockhash,
        instructions: txInstructions
    }).compileToV0Message(); // 👈 NOTE: We do NOT include the lookup table
    const transactionWithoutLookupTable = new web3.VersionedTransaction(messageWithoutLookupTable);
    transactionWithoutLookupTable.sign([payer]);

    console.log("   ✅ - Compiled transactions");

    // Step 6 - Log our transaction size
    console.log('Transaction size without address lookup table: ', transactionWithoutLookupTable.serialize().length, 'bytes');
    console.log('Transaction size with address lookup table:    ', transactionWithLookupTable.serialize().length, 'bytes');
}

async function main() {
    console.log('Step 1: create address lookup table')
    const lookupTableAddress = await createALTs()

    // const get = await connection.getAddressLookupTable(lookupTableAddress)
    // console.log('get:', get)

    // Wait for 1 minute (60,000 milliseconds) before proceeding to Step 2
    console.log('Waiting for 1 minute...')
    await new Promise(resolve => setTimeout(resolve, 60000))

    const addresses = [
        new web3.PublicKey('8Z17Y623ZjNV8xaAdxgn5ZkqkVTEo8Yc6uaapvcrFB62'),
        new web3.PublicKey('846HwwmSGguDbipzs2xDYCsfyhi4j2LLiuQri11woums'),
        new web3.PublicKey('FueGNmz4M2wphGnDL5RuH2fCo6EQxxtheVn6syGE4Fh1'),
        new web3.PublicKey('8io2LqthLyQfFncj6QAaQ2q5d7z9WgRcVKrAz4DGNiee'),
    ]

    console.log('Step 2: add address to lookup table')
    await addAddress(lookupTableAddress, addresses)
    // await addAddress(new web3.PublicKey('2JBnRGupE5MCJkAjSLk7wpa4fkuuEVZVXcndwSqDWj8c'), addresses)

    // console.log('Step3: fetch lookup table and parse all the addresses stored in the table')
    // const lookupTableAccount = await fetchALTs(lookupTableAddress)
    // const lookupTableAccount = await fetchALTs(new web3.PublicKey('AvYgEcPa4m9vb9ojHsWxNf8wdgoFvC7w28DhkADsE7EQ'))

    console.log('Step 3: check the transaction size')
    await compareTxSize(lookupTableAddress)
    // await compareTxSize(new web3.PublicKey('2JBnRGupE5MCJkAjSLk7wpa4fkuuEVZVXcndwSqDWj8c'))


}

main()