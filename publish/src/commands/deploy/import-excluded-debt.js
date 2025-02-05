'use strict';

const { white, gray, yellow } = require('chalk');
const { confirmAction } = require('../../util');

module.exports = async ({ deployer, freshDeploy, runStep }) => {
	console.log(gray(`\n------ IMPORT DEBT-CACHE EXCLUDED-DEBT RECORDS ------\n`));

	const { DebtCache } = deployer.deployedContracts;

	// fresh deploys or no new debt cache mean this should be skipped
	if (freshDeploy) {
		console.log(gray(`freshDeploy - no excluded debt required to import. Skipping.`));
		return;
	}

	const ExistingDebtCache = deployer.getExistingContract({ contract: 'DebtCache' });
	const ExistingIssuer = deployer.getExistingContract({ contract: 'Issuer' });

	if (ExistingDebtCache.options.address === DebtCache.options.address) {
		console.log(gray(`No excluded debt required to import. Skipping.`));
		return;
	}

	const initialized = await DebtCache.methods.isInitialized().call();

	// it shouldn't be initialized, but it can be already initilized
	// during a weird multi-part release because the "previous" contracts
	// are resolved according to version numbers in deployments.json, in which case
	// the import step should be skipped for the second part of the release
	if (initialized) {
		console.log(
			yellow(`⚠⚠⚠ WARNING import-excluded-debt: DebtCache already initialized\n`),
			gray('-'.repeat(50)) + '\n'
		);

		try {
			await confirmAction(
				gray(
					'import-excluded-debt step has to be skipped, ' +
						'otherwise it will fail. Confirm you know the reason, and this is ok! (y/n)'
				)
			);
			console.log(gray('Skipping importing excluded debt.'));
			return;
		} catch (err) {
			throw Error(`aborting due to DebtCache being already initialized`);
		}
	}

	console.log(gray(`Existing DebtCache (source of debts) at: ${white(ExistingDebtCache.options.address)}`));
	console.log(
		gray(`Existing Issuer (source of currencyKeys) at: ${white(ExistingIssuer.options.address)}`)
	);
	console.log(gray(`New DebtCache at: ${yellow(DebtCache.options.address)}`));

	await runStep({
		contract: 'DebtCache',
		target: DebtCache,
		write: 'importExcludedIssuedDebts',
		writeArg: [ExistingDebtCache.options.address, ExistingIssuer.options.address],
		comment: `Import excluded-debt records from existing DebtCache`,
	});
};
