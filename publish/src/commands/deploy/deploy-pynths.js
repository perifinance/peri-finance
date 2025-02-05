'use strict';

const { gray, yellow } = require('chalk');

const { confirmAction } = require('../../util');

const {
	toBytes32,
	constants: { ZERO_ADDRESS },
} = require('../../../..');

module.exports = async ({
	account,
	addressOf,
	addNewPynths,
	config,
	deployer,
	freshDeploy,
	generateSolidity,
	network,
	pynths,
	systemSuspended,
	useFork,
	yes,
	validatorAddress,
}) => {
	// ----------------
	// Pynths
	// ----------------
	console.log(gray(`\n------ DEPLOY PYNTHS ------\n`));

	const { Issuer, ReadProxyAddressResolver } = deployer.deployedContracts;

	// The list of pynth to be added to the Issuer once dependencies have been set up
	const pynthsToAdd = [];

	for (const { name: currencyKey, subclass } of pynths) {
		console.log(gray(`\n   --- PYNTH ${currencyKey} ---\n`));

		const tokenStateForPynth = await deployer.deployContract({
			name: `TokenState${currencyKey}`,
			source: 'TokenState',
			args: [account, ZERO_ADDRESS],
			force: addNewPynths,
		});

		const proxyForPynth = await deployer.deployContract({
			name: `Proxy${currencyKey}`,
			source: 'ProxyERC20',
			args: [account],
			force: addNewPynths,
		});

		const currencyKeyInBytes = toBytes32(currencyKey);

		const pynthConfig = config[`Pynth${currencyKey}`] || {};

		// track the original supply if we're deploying a new pynth contract for an existing pynth
		let originalTotalSupply = 0;
		if (pynthConfig.deploy) {
			try {
				const oldPynth = deployer.getExistingContract({ contract: `Pynth${currencyKey}` });
				originalTotalSupply = await oldPynth.totalSupply();
			} catch (err) {
				if (!freshDeploy) {
					// only throw if not local - allows local environments to handle both new
					// and updating configurations
					throw err;
				}
			}
		}

		// user confirm totalSupply is correct for oldPynth before deploy new Pynth
		if (pynthConfig.deploy && originalTotalSupply > 0) {
			if (!systemSuspended && !generateSolidity && !useFork) {
				console.log(
					yellow(
						'⚠⚠⚠ WARNING: The system is not suspended! Adding a pynth here without using a migration contract is potentially problematic.'
					) +
						yellow(
							`⚠⚠⚠ Please confirm - ${network}:\n` +
								`Pynth${currencyKey} totalSupply is ${originalTotalSupply} \n` +
								'NOTE: Deploying with this amount is dangerous when the system is not already suspended'
						),
					gray('-'.repeat(50)) + '\n'
				);

				if (!yes) {
					try {
						await confirmAction(gray('Do you want to continue? (y/n) '));
					} catch (err) {
						console.log(gray('Operation cancelled'));
						process.exit();
					}
				}
			}
		}

		const readProxyForResolver = deployer.getExistingContract({ contract: `ReadProxyAddressResolver` });

		const sourceContract = subclass || 'Pynth';
		const pynth = await deployer.deployContract({
			name: `Pynth${currencyKey}`,
			source: sourceContract,
			deps: [`TokenState${currencyKey}`, `Proxy${currencyKey}`, 'PeriFinance', 'FeePool'],
			args: sourceContract === 'MultiCollateralPynth'
			? [
					addressOf(proxyForPynth),
					addressOf(tokenStateForPynth),
					`Pynth ${currencyKey}`,
					currencyKey,
					account,
					currencyKeyInBytes,
					originalTotalSupply,
					addressOf(readProxyForResolver),
					validatorAddress,
			  ]
			: [
					addressOf(proxyForPynth),
					addressOf(tokenStateForPynth),
					`Pynth ${currencyKey}`,
					currencyKey,
					account,
					currencyKeyInBytes,
					originalTotalSupply,
					addressOf(readProxyForResolver),
			  ],
			force: addNewPynths,
		});

		// Save the pynth to be added once the AddressResolver has been synced.
		if (pynth && Issuer) {
			pynthsToAdd.push({
				pynth,
				currencyKeyInBytes,
			});
		}
	}

	return {
		pynthsToAdd,
	};
};
