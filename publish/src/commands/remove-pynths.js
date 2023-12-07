'use strict';

const fs = require('fs');
const { gray, yellow, red, cyan } = require('chalk');
const Web3 = require('web3');
const w3utils = require('web3-utils');

const {
	toBytes32,
	constants: { CONFIG_FILENAME, DEPLOYMENT_FILENAME },
} = require('../../..');

const {
	ensureNetwork,
	ensureDeploymentPath,
	getDeploymentPathForNetwork,
	loadAndCheckRequiredSources,
	loadConnections,
	confirmAction,
	stringify,
	performTransactionalStep,
} = require('../util');

const DEFAULTS = {
	network: 'kovan',
	gasLimit: 3e5,
	gasPrice: '1',
};

const ProxyERC20 = {
	mainnet: 'PeriFinanceToEthereum',
	goerli: 'PeriFinanceToEthereum',
	bsc: 'PeriFinanceToBSC',
	bsctest: 'PeriFinanceToBSC',
	polygon: 'PeriFinanceToPolygon',
	moonriver: 'PeriFinance',
};

const removePynths = async ({
	network = DEFAULTS.network,
	deploymentPath,
	gasPrice = DEFAULTS.gasPrice,
	gasLimit = DEFAULTS.gasLimit,
	pynthsToRemove = [],
	yes,
	privateKey,
}) => {
	ensureNetwork(network);
	deploymentPath = deploymentPath || getDeploymentPathForNetwork({ network });
	ensureDeploymentPath(deploymentPath);

	const {
		pynths,
		pynthsFile,
		deployment,
		deploymentFile,
		config,
		configFile,
		ownerActions,
		ownerActionsFile,
	} = loadAndCheckRequiredSources({
		deploymentPath,
		network,
	});

	if (pynthsToRemove.length < 1) {
		console.log(gray('No pynths provided. Please use --pynths-to-remove option'));
		return;
	}

	// sanity-check the pynth list
	for (const pynth of pynthsToRemove) {
		if (pynths.filter(({ name }) => name === pynth).length < 1) {
			console.error(red(`Pynth ${pynth} not found!`));
			process.exitCode = 1;
			return;
		} else if (['pUSD'].indexOf(pynth) >= 0) {
			console.error(red(`Pynth ${pynth} cannot be removed`));
			process.exitCode = 1;
			return;
		}
	}

	const { providerUrl, privateKey: envPrivateKey, etherscanLinkPrefix } = loadConnections({
		network,
	});

	// allow local deployments to use the private key passed as a CLI option
	if (network !== 'local' || !privateKey) {
		privateKey = envPrivateKey;
	}

	const web3 = new Web3(new Web3.providers.HttpProvider(providerUrl));
	web3.eth.accounts.wallet.add(privateKey);
	const account = web3.eth.accounts.wallet[0].address;
	console.log(gray(`Using account with public key ${account}`));
	console.log(gray(`Using gas of ${gasPrice} GWEI with a max of ${gasLimit}`));

	if (!yes) {
		try {
			await confirmAction(
				cyan(
					`${yellow(
						'⚠ WARNING'
					)}: This action will remove the following pynths from the PeriFinance contract on ${network}:\n- ${pynthsToRemove.join(
						'\n- '
					)}`
				) + '\nDo you want to continue? (y/n) '
			);
		} catch (err) {
			console.log(gray('Operation cancelled'));
			return;
		}
	}

	console.log(gray(`Removing pynths from PeriFinance contract, ${ProxyERC20[network]}...`));

	const PeriFinance = new web3.eth.Contract(
		deployment.sources[ProxyERC20[network]].abi,
		deployment.targets['PeriFinance'].address
	);

	const Issuer = new web3.eth.Contract(
		deployment.sources['Issuer'].abi,
		deployment.targets['Issuer'].address
	);

	// deep clone these configurations so we can mutate and persist them
	const updatedConfig = JSON.parse(JSON.stringify(config));
	const updatedDeployment = JSON.parse(JSON.stringify(deployment));
	let updatedPynths = JSON.parse(fs.readFileSync(pynthsFile));

	for (const currencyKey of pynthsToRemove) {
		const { address: pynthAddress, source: pynthSource } = deployment.targets[
			`Pynth${currencyKey}`
		];
		const { abi: pynthABI } = deployment.sources[pynthSource];
		const Pynth = new web3.eth.Contract(pynthABI, pynthAddress);

		const currentPynthInPERI = await PeriFinance.methods.pynths(toBytes32(currencyKey)).call();

		if (pynthAddress !== currentPynthInPERI) {
			try {
				await confirmAction(
					red(
						`${yellow(
							'⚠ WARNING'
						)}: Pynth address in PeriFinance for ${currencyKey} is different from what's deployed in PeriFinance to the local ${DEPLOYMENT_FILENAME} of ${network} \ndeployed: ${yellow(
							currentPynthInPERI
						)}\nlocal:    ${yellow(pynthAddress)}`
					) + '\nDo you want to continue? (y/n) '
				);
			} catch (err) {
				console.log(gray('Operation cancelled'));
				process.exitCode = 1;
				return;
			}
		}

		if (pynthAddress === currentPynthInPERI) {
			// now check total supply (is required in PeriFinance.removePynth)
			const totalSupply = w3utils.fromWei(await Pynth.methods.totalSupply().call());
			if (Number(totalSupply) > 0) {
				console.error(
					red(
						`Cannot remove as Pynth${currencyKey}.totalSupply is non-zero: ${yellow(
							totalSupply
						)}\nThe Pynth must be purged of holders.`
					)
				);
				process.exitCode = 1;
				return;
			}

			// perform transaction if owner of PeriFinance or append to owner actions list
			await performTransactionalStep({
				account,
				contract: 'Issuer',
				target: Issuer,
				write: 'removePynth',
				writeArg: toBytes32(currencyKey),
				gasLimit,
				gasPrice,
				etherscanLinkPrefix,
				ownerActions,
				ownerActionsFile,
				encodeABI: network === 'mainnet',
			});
		}

		// now update the config and deployment JSON files
		const contracts = ['ProxyERC20', 'TokenState', 'Pynth'].map(name => `${name}${currencyKey}`);
		for (const contract of contracts) {
			delete updatedConfig[contract];
			delete updatedDeployment.targets[contract];
		}
		if (contracts) {
			fs.writeFileSync(configFile, stringify(updatedConfig));
			fs.writeFileSync(deploymentFile, stringify(updatedDeployment));
		}
		// and update the pynths.json file
		updatedPynths = updatedPynths.filter(({ name }) => name !== currencyKey);
		fs.writeFileSync(pynthsFile, stringify(updatedPynths));
	}
};

module.exports = {
	removePynths,
	cmd: program =>
		program
			.command('remove-pynths')
			.description('Remove a number of pynths from the system')
			.option(
				'-d, --deployment-path <value>',
				`Path to a folder that has your input configuration file ${CONFIG_FILENAME} and where your ${DEPLOYMENT_FILENAME} files will go`
			)
			.option('-g, --gas-price <value>', 'Gas price in GWEI', 1)
			.option('-l, --gas-limit <value>', 'Gas limit', 1e6)
			.option('-n, --network <value>', 'The network to run off.', x => x.toLowerCase(), 'kovan')
			.option(
				'-s, --pynths-to-remove <value>',
				'The list of pynths to remove',
				(val, memo) => {
					memo.push(val);
					return memo;
				},
				[]
			)
			.option('-v, --private-key [value]')
			.action(removePynths),
};
