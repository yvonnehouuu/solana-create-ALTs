# Solana Address Lookup Table(ALTs)
## About ALTs
_"After all the desired addresses have been stored on chain in an Address Lookup Table, each address can be referenced inside a transaction by its 1-byte index within the table (instead of their full 32-byte address). This lookup method effectively "compresses" a 32-byte address into a 1-byte index value._

_This "compression" enables storing up to 256 addresses in a single lookup table for use inside any given transaction."_     __[solana](https://docs.solana.com/developing/lookup-tables)

## Versioned Transactions([what's versioned transaction on solana?](https://www.quicknode.com/guides/solana-development/transactions/how-to-use-versioned-transactions-on-solana))
_"To utilize an Address Lookup Table inside a transaction, developers must use v0 transactions that were introduced with the new Versioned Transaction format."_      __[solana](https://docs.solana.com/developing/lookup-tables#versioned-transactions)

According to solana official documents, the Solana runtime supports two transaction versions: `legacy`(old) and `0`(added support for Address Lookup Tables).


## Part 1: Create a V0 Transaction for Creating ALTs and Adding Addresses to ALTs
After generating the instruction, we need to send a transaction that can interact with the **address lookup table program**. As the documentation says, we need to use V0 transactions.

Unlike transactions that we need when we use a lookup table in a transaction, we don't need to add the address of the lookup table to the V0 transaction, The difference will be noted later when creating a transaction that requires the use of a lookup table.

Here's my code:
```javascript
async function createAndSendV0Tx(arrayOfInstructions) {
    let latestBlockhash = await connection.getLatestBlockhash('finalized');
    console.log("   ✅ - Fetched latest blockhash. Last valid height:", latestBlockhash.lastValidBlockHeight);

    // construct a v0 compatible transaction `Message`
    const messageV0 = new web3.TransactionMessage({
        payerKey: payer.publicKey,
        recentBlockhash: latestBlockhash.blockhash,
        instructions: arrayOfInstructions, // note this is an array of instructions
    }).compileToV0Message();
    console.log("   ✅ - Compiled transaction message");

    // create a v0 transaction from the v0 message
    const transactionV0 = new web3.VersionedTransaction(messageV0);

    // sign the v0 transaction using the file system wallet we created named `payer`
    transactionV0.sign([payer]);
    console.log("   ✅ - Transaction Signed");

    // send and confirm the transaction
    const txid = await web3.sendAndConfirmTransaction(connection, transactionV0);

    console.log('🎉 Transaction succesfully confirmed!', '\n', `https://explorer.solana.com/tx/${txid}?cluster=devnet`);
}
```




## Part 2: Create Address Lookup Table
Create a new async function `createALTs`, it will build our instruction and call createAndSendV0Tx

``` javascript
async function createALTs() {
    const slot = await connection.getSlot();
    // console.log('slot:', slot);

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
```




## Part 3: Add Addresses to Lookup Table
Same as Part2.

``` javascript
async function addAddress(lookupTableAddress, addresses) {
    // add addresses to the `lookupTableAddress` table via an `extend` instruction
    const extendInstruction = web3.AddressLookupTableProgram.extendLookupTable({
        payer: payer.publicKey,
        authority: payer.publicKey,
        lookupTable: lookupTableAddress,
        addresses: addresses
    });

    // Send this `extendInstruction` in a transaction to the cluster
    // to insert the listing of `addresses` into your lookup table with address `lookupTableAddress`
    // console.log('extendInstruction:', extendInstruction)

    await createAndSendV0Tx([extendInstruction]);
    console.log(`Lookup Table Entries: `, `https://explorer.solana.com/address/${lookupTableAddress.toString()}/entries?cluster=devnet`)
}
```




## Part 4: Use Lookup Table in Transaction

``` javascript
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

```

## Part 5: main function
``` javascript
async function main() {
    console.log('Step 1: create address lookup table')
    const lookupTableAddress = await createALTs()

    const addresses = [
        new web3.PublicKey('8Z17Y623ZjNV8xaAdxgn5ZkqkVTEo8Yc6uaapvcrFB62'),
        new web3.PublicKey('846HwwmSGguDbipzs2xDYCsfyhi4j2LLiuQri11woums'),
        new web3.PublicKey('FueGNmz4M2wphGnDL5RuH2fCo6EQxxtheVn6syGE4Fh1'),
        new web3.PublicKey('8io2LqthLyQfFncj6QAaQ2q5d7z9WgRcVKrAz4DGNiee'),
    ]

    console.log('Step 2: add address to lookup table')
    await addAddress(lookupTableAddress, addresses)

    console.log('Step 3: check the transaction size')
    await compareTxSize(lookupTableAddress)
}
```

```
main()
```

