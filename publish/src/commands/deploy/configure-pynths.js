'use strict';

const { gray } = require('chalk');
const {
	utils: { isAddress },
} = require('ethers');
const { toBytes32 } = require('../../../..');

module.exports = async ({
	addressOf,
	deployer,
	explorerLinkPrefix,
	feeds,
	generateSolidity,
	network,
	runStep,
	pynths,
}) => {
	// now configure pynths
	console.log(gray(`\n------ CONFIGURE PYNTHS ------\n`));

	const { ExchangeRates } = deployer.deployedContracts;

	for (const { name: currencyKey, asset } of pynths) {
		console.log(gray(`\n   --- PYNTH ${currencyKey} ---\n`));

		const currencyKeyInBytes = toBytes32(currencyKey);

		const pynth = deployer.deployedContracts[`Pynth${currencyKey}`];
		const tokenStateForPynth = deployer.deployedContracts[`TokenState${currencyKey}`];
		const proxyForPynth = deployer.deployedContracts[`Proxy${currencyKey}`];

		let ExistingPynth;
		try {
			ExistingPynth = deployer.getExistingContract({ contract: `Pynth${currencyKey}` });
		} catch (err) {
			// ignore error as there is no existing pynth to copy from
		}
		// when generating solidity only, ensure that this is run to copy across pynth supply
		if (pynth && generateSolidity && ExistingPynth && ExistingPynth.address !== pynth.address) {
			const generateExplorerComment = ({ address }) =>
				`// ${explorerLinkPrefix}/address/${address}`;

			await runStep({
				contract: `Pynth${currencyKey}`,
				target: pynth,
				write: 'setTotalSupply',
				writeArg: addressOf(pynth),
				comment: `Ensure the new pynth has the totalSupply from the previous one`,
				customSolidity: {
					name: `copyTotalSupplyFrom_${currencyKey}`,
					instructions: [
						generateExplorerComment({ address: ExistingPynth.address }),
						`Pynth existingPynth = Pynth(${ExistingPynth.address})`,
						generateExplorerComment({ address: pynth.address }),
						`Pynth newPynth = Pynth(${pynth.address})`,
						`newPynth.setTotalSupply(existingPynth.totalSupply())`,
					],
				},
			});
		}

		if (tokenStateForPynth && pynth) {
			await runStep({
				contract: `TokenState${currencyKey}`,
				target: tokenStateForPynth,
				read: 'associatedContract',
				expected: input => input === addressOf(pynth),
				write: 'setAssociatedContract',
				writeArg: addressOf(pynth),
				comment: `Ensure the ${currencyKey} pynth can write to its TokenState`,
			});
		}

		// Setup proxy for pynth
		if (proxyForPynth && pynth) {
			await runStep({
				contract: `Proxy${currencyKey}`,
				target: proxyForPynth,
				read: 'target',
				expected: input => input === addressOf(pynth),
				write: 'setTarget',
				writeArg: addressOf(pynth),
				comment: `Ensure the ${currencyKey} pynth Proxy is correctly connected to the Pynth`,
			});

			await runStep({
				contract: `Pynth${currencyKey}`,
				target: pynth,
				read: 'proxy',
				expected: input => input === addressOf(proxyForPynth),
				write: 'setProxy',
				writeArg: addressOf(proxyForPynth),
				comment: `Ensure the ${currencyKey} pynth is connected to its Proxy`,
			});
		}

		const { feed } = feeds[asset] || {};

		// now setup price aggregator if any for the pynth
		if (isAddress(feed) && ExchangeRates) {
			await runStep({
				contract: `ExchangeRates`,
				target: ExchangeRates,
				read: 'aggregators',
				readArg: currencyKeyInBytes,
				expected: input => input === feed,
				write: 'addAggregator',
				writeArg: [currencyKeyInBytes, feed],
				comment: `Ensure the ExchangeRates contract has the feed for ${currencyKey}`,
			});
		}
	}
};
