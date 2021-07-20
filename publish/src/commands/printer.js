const {
	ensureNetwork,
	ensureDeploymentPath,
	getDeploymentPathForNetwork,
	loadAndCheckRequiredSources,
	reportDeployedContracts,
} = require('../util');

const {
	constants: { CONFIG_FILENAME, PYNTHS_FILENAME, DEPLOYMENT_FILENAME },
} = require('../../../');

const DEFAULTS = {
	network: 'kovan',
};

const printer = async ({ network = DEFAULTS.network, deploymentPath }) => {
	ensureNetwork(network);
	deploymentPath = deploymentPath || getDeploymentPathForNetwork({ network });
	ensureDeploymentPath(deploymentPath);

	const { deployment } = loadAndCheckRequiredSources({
		deploymentPath,
		network,
	});

	const deployer = { network, newContractsDeployed: Object.values(deployment.targets), deployment };

	reportDeployedContracts({ deployer });
};

module.exports = {
	printer,
	cmd: program =>
		program
			.command('printer')
			.description('print all contracts deployed')
			.option('-n, --network <value>', `The network which scheduler will be called`)
			.option(
				'-d, --deployment-path <value>',
				`Path to a folder that has your input configuration file ${CONFIG_FILENAME}, the pynth list ${PYNTHS_FILENAME} and where your ${DEPLOYMENT_FILENAME} files will go`
			)
			.action(printer),
};
