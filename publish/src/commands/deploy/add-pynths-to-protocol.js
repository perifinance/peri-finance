'use strict';

const { gray } = require('chalk');

module.exports = async ({ addressOf, deployer, runStep, pynthsToAdd }) => {
	console.log(gray(`\n------ ADD PYNTHS TO ISSUER ------\n`));

	const { Issuer } = deployer.deployedContracts;

	// Set up the connection to the Issuer for each Pynth (requires FlexibleStorage to have been configured)

	// First filter out all those pynths which are already properly imported
	console.log(gray('Filtering pynths to add to the issuer.'));
	const filteredPynths = [];
	const seen = new Set();
	for (const pynth of pynthsToAdd) {
		const issuerPynthAddress = await Issuer.pynths(pynth.currencyKeyInBytes);
		const currentPynthAddress = addressOf(pynth.pynth);
		if (issuerPynthAddress === currentPynthAddress) {
			console.log(gray(`${currentPynthAddress} requires no action`));
		} else if (!seen.has(pynth.currencyKeyInBytes)) {
			console.log(gray(`${currentPynthAddress} will be added to the issuer.`));
			filteredPynths.push(pynth);
		}
		seen.add(pynth.currencyKeyInBytes);
	}

	const pynthChunkSize = 15;
	let batchCounter = 1;
	for (let i = 0; i < filteredPynths.length; i += pynthChunkSize) {
		const chunk = filteredPynths.slice(i, i + pynthChunkSize);
		await runStep({
			contract: 'Issuer',
			target: Issuer,
			read: 'getPynths',
			readArg: [chunk.map(pynth => pynth.currencyKeyInBytes)],
			expected: input =>
				input.length === chunk.length &&
				input.every((cur, idx) => cur === addressOf(chunk[idx].pynth)),
			write: 'addPynths',
			writeArg: [chunk.map(pynth => addressOf(pynth.pynth))],
			gasLimit: 1e5 * pynthChunkSize,
			comment: `Add pynths to the Issuer contract - batch ${batchCounter++}`,
		});
	}
};
