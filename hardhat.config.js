'use strict';
require('dotenv').config();

const path = require('path');
require('./hardhat');
require('@nomiclabs/hardhat-truffle5');
require('@nomiclabs/hardhat-ethers');
require('@nomiclabs/hardhat-web3');
require('@nomiclabs/hardhat-etherscan');

require('solidity-coverage');
require('hardhat-gas-reporter');

const {
	constants: { AST_FILENAME, AST_FOLDER, BUILD_FOLDER },
} = require('.');

// console.log(inflationStartTimestampInSecs);

const GAS_PRICE = 900e9; // 100 GWEI
const CACHE_FOLDER = 'cache';

// task('accounts', 'Prints the list of accounts', async (taskArgs, hre) => {
// 	const accounts = await hre.ethers.getSigners();

// 	for (const account of accounts) {
// 		console.log(account.address);
// 	}
// });

module.exports = {
	GAS_PRICE,
	ovm: {
		solcVersion: '0.5.16',
	},
	solidity: {
		compilers: [
			{
				version: '0.4.25',
			},
			{
				version: '0.5.16',
				settings: {
					optimizer: {
						enabled: true,
						runs: 200,
					},
				},
			},
		],
	},
	paths: {
		sources: './contracts',
		tests: './test/contracts',
		artifacts: path.join(BUILD_FOLDER, 'artifacts'),
		cache: path.join(BUILD_FOLDER, CACHE_FOLDER),
	},
	astdocs: {
		path: path.join(BUILD_FOLDER, AST_FOLDER),
		file: AST_FILENAME,
		ignores: 'test-helpers',
	},
	defaultNetwork: 'hardhat',
	networks: {
		hardhat: {
			chainId: 1337,
			gas: 12e6,
			blockGasLimit: 12e6,
			allowUnlimitedContractSize: true,
			gasPrice: GAS_PRICE,
			initialDate: new Date().toISOString(), // new Date(inflationStartTimestampInSecs * 1000).toISOString(),
			// Note: forking settings are injected at runtime by hardhat/tasks/task-node.js
			// forking: {
			// 	url: 'https://polygon-bor.publicnode.com',
			// },
		},
	},
	gasReporter: {
		enabled: process.env.REPORT_GAS,
		showTimeSpent: true,
		currency: 'USD',
		maxMethodDiff: 25, // CI will fail if gas usage is > than this %
		outputFile: 'test-gas-used.log',
		coinmarketcap: process.env.COINMARKETCAP_API_KEY,
	},
};
