'use strict';

const w3utils = require('web3-utils');
const abiDecoder = require('abi-decoder');

// load the data in explicitly (not programmatically) so webpack knows what to bundle
const data = {
	kovan: require('./publish/deployed/kovan'),
	rinkeby: require('./publish/deployed/rinkeby'),
	ropsten: require('./publish/deployed/ropsten'),
	mainnet: require('./publish/deployed/mainnet'),
	goerli: require('./publish/deployed/goerli'),
	// 'goerli-ovm': require('./publish/deployed/goerli-ovm'),
	// 'kovan-ovm': require('./publish/deployed/kovan-ovm'),
	// 'mainnet-ovm': require('./publish/deployed/mainnet-ovm'),
	polygon: require('./publish/deployed/polygon'),
	mumbai: require('./publish/deployed/mumbai'),
	bsctest: require('./publish/deployed/bsctest'),
	bsc: require('./publish/deployed/bsc'),
	shibuya: require('./publish/deployed/shibuya'),
	'moonbase-alphanet': require('./publish/deployed/moonbase-alphanet'),
	moonriver: require('./publish/deployed/moonriver'),
	'base-sepolia': require('./publish/deployed/base-sepolia'),
	base: require('./publish/deployed/base'),
	moonbeam: require('./publish/deployed/moonbeam'),
	sepolia: require('./publish/deployed/sepolia'),
};

const assets = require('./publish/assets.json');
const ovmIgnored = require('./publish/ovm-ignore.json');
const nonUpgradeable = require('./publish/non-upgradeable.json');
const releases = require('./publish/releases.json');

const networks = [
	'local',
	'kovan',
	'rinkeby',
	'ropsten',
	'mainnet',
	'goerli',
	'polygon',
	'mumbai',
	'bsctest',
	'bsc',
	'shibuya',
	'moonbase-alphanet',
	'moonriver',
	'moonbeam',
	'base-sepolia',
	'base',
	'sepolia',
	'polygon-fork',
];

const chainIdMapping = Object.entries({
	1: {
		network: 'mainnet',
	},
	3: {
		network: 'ropsten',
	},
	4: {
		network: 'rinkeby',
	},
	5: {
		network: 'goerli',
	},
	42: {
		network: 'kovan',
	},
	84532: {
		network: 'base-sepolia',
	},

	// Hardhat fork of mainnet: https://hardhat.org/config/#hardhat-network
	1337: {
		network: 'polygon',
		fork: true,
	},

	31337: {
		network: 'local',
	},
	/* // OVM networks: see https://github.com/ethereum-optimism/regenesis/
	10: {
		network: 'mainnet',
		useOvm: true,
	},
	69: {
		network: 'kovan',
		useOvm: true,
	},
	'-1': {
		// no chain ID for this currently
		network: 'goerli',
		useOvm: true,
	}, */
	// now append any defaults
	137: {
		network: 'polygon',
	},
	80001: {
		network: 'mumbai',
	},
	97: {
		network: 'bsctest',
	},
	56: {
		network: 'bsc',
	},
	81: {
		network: 'shibuya',
	},
	1287: {
		network: 'moonbase-alphanet',
	},
	1284: {
		network: 'moonbeam',
	},
	1285: {
		network: 'moonriver',
	},
	8453: {
		network: 'base',
	},
	11155111: {
		network: 'sepolia',
	},
}).reduce((memo, [id, body]) => {
	memo[id] = Object.assign({ useOvm: false, fork: false }, body);
	return memo;
}, {});

const getNetworkFromId = ({ id }) => chainIdMapping[id];

const networkToChainId = Object.entries(chainIdMapping).reduce(
	(memo, [id, { network, useOvm, fork }]) => {
		memo[network + (useOvm ? '-ovm' : '') + (fork ? '-fork' : '')] = id;
		return memo;
	},
	{}
);

const constants = {
	BUILD_FOLDER: 'build',
	CONTRACTS_FOLDER: 'contracts',
	COMPILED_FOLDER: 'compiled',
	FLATTENED_FOLDER: 'flattened',
	AST_FOLDER: 'ast',

	CONFIG_FILENAME: 'config.json',
	PARAMS_FILENAME: 'params.json',
	PYNTHS_FILENAME: 'pynths.json',
	STAKING_REWARDS_FILENAME: 'rewards.json',
	SHORTING_REWARDS_FILENAME: 'shorting-rewards.json',
	OWNER_ACTIONS_FILENAME: 'owner-actions.json',
	DEPLOYMENT_FILENAME: 'deployment.json',
	VERSIONS_FILENAME: 'versions.json',
	FEEDS_FILENAME: 'feeds.json',

	AST_FILENAME: 'asts.json',

	ZERO_ADDRESS: '0x' + '0'.repeat(40),

	OVM_MAX_GAS_LIMIT: '8999999',

	// inflationStartTimestampInSecs: 1626480000, // Saturday, July 17, 2021 9:00:00 AM GMT+09:00
	inflationStartTimestampInSecs: 1625875200, // Saturday, July 10, 2021 9:00:00 AM GMT+09:00
};

const knownAccounts = {
	mainnet: [
		// {
		// 	name: 'binance', // Binance 8 Wallet
		// 	address: '0xF977814e90dA44bFA03b6295A0616a897441aceC',
		// },
		// {
		// 	name: 'renBTCWallet', // KeeperDAO wallet (has renBTC and ETH)
		// 	address: '0x35ffd6e268610e764ff6944d07760d0efe5e40e5',
		// },
		// {
		// 	name: 'loansAccount',
		// 	address: '0x62f7A1F94aba23eD2dD108F8D23Aa3e7d452565B',
		// },
	],
	rinkeby: [],
	ropsten: [],
	goerli: [],
	kovan: [],
	mumbai: [],
	polygon: [],
	bsctest: [],
	bsc: [],
	'moonbase-alphanet': [],
	moonriver: [],
	moonbeam: [],
	'base-sepolia': [],
	base: [],
	sepolia: [],
};

// The solidity defaults are managed here in the same format they will be stored, hence all
// numbers are converted to strings and those with 18 decimals are also converted to wei amounts
const defaults = {
	WAITING_PERIOD_SECS: (60 * 5).toString(), // 5 mins
	PRICE_DEVIATION_THRESHOLD_FACTOR: w3utils.toWei('3'),
	TRADING_REWARDS_ENABLED: false,
	ISSUANCE_RATIO: w3utils
		.toBN(1)
		.mul(w3utils.toBN(1e18))
		.div(w3utils.toBN(4))
		.toString(), // 1/4 = 0.25
	MAX_EXTERNAL_TOKEN_QUOTA: w3utils
		.toBN(5)
		.mul(w3utils.toBN(1e17))
		.toString(),
	FEE_PERIOD_DURATION: (60 * 60 * (24 * 7 - 3)).toString(), // 1 week - 3 hours
	TARGET_THRESHOLD: '1', // 1% target threshold (it will be converted to a decimal when set)
	LIQUIDATION_DELAY: (60 * 60 * 24 * 1).toString(), // 1 days
	LIQUIDATION_RATIO: w3utils.toWei('0.666666666666666666'), // 150% cratio
	LIQUIDATION_RATIOS: {
		P: w3utils.toWei('0.666666666666666666'),
		C: w3utils.toWei('0.8'),
		I: w3utils.toWei('0.833333333333333333'),
	},
	LIQUIDATION_PENALTY: w3utils.toWei('0.1'), // 10% penalty
	RATE_STALE_PERIOD: (3600 * 25).toString(), // 25 hours
	EXCHANGE_FEE_RATES: {
		forex: w3utils.toWei('0.003'),
		commodity: w3utils.toWei('0.003'),
		equities: w3utils.toWei('0.003'),
		crypto: w3utils.toWei('0.003'),
		index: w3utils.toWei('0.003'),
	},
	MINIMUM_STAKE_TIME: (3600 * 24).toString(), // 1 days
	DEBT_SNAPSHOT_STALE_TIME: (43800).toString(), // 12 hour heartbeat + 10 minutes mining time
	// DEBT_SNAPSHOT_STALE_TIME: (3600 * 25 + 600).toString(), // 25 hour heartbeat + 10 minutes mining time
	SYNC_STALE_THRESHOLD: w3utils
		.toBN(1)
		.mul(w3utils.toBN(1e18))
		.div(w3utils.toBN(20))
		.toString(), // 1/20 5%
	BRIDGE_CLAIM_GAS_COST: w3utils.toWei(`7095534.6`, 'gwei'),
	BRIDGE_TRANSFER_GAS_COST: w3utils.toWei(`8867349.3`, 'gwei'),
	INITIAL_ISSUANCE: 0, // w3utils.toWei(`${2e6}`),
	LAST_MINT_EVENT: 1713052800, // Sun Apr 14 2024 00:00:00 GMT+0000
	INFLATION_WEEK_COUNTER: 144, // 140,
	EXTERNAL_TOKEN_ISSUANCE_RATIO: {
		USDC: w3utils.toWei('1'),
		USDT: w3utils.toWei('1'),
		DAI: w3utils.toWei('1'),
		PAXG: w3utils.toWei('0.75'),
		XAUT: w3utils.toWei('0.75'),
	},
	AGGREGATOR_WARNING_FLAGS: {
		mainnet: '0x4A5b9B4aD08616D11F3A402FF7cBEAcB732a76C6',
		kovan: '0x6292aa9a6650ae14fbf974e5029f36f95a1848fd',
	},
	RENBTC_ERC20_ADDRESSES: {
		mainnet: '0xEB4C2781e4ebA804CE9a9803C67d0893436bB27D',
		kovan: '0x9B2fE385cEDea62D839E4dE89B0A23EF4eacC717',
		goerli: constants.ZERO_ADDRESS,
		rinkeby: '0xEDC0C23864B041607D624E2d9a67916B6cf40F7a',
		ropsten: constants.ZERO_ADDRESS,
		mumbai: constants.ZERO_ADDRESS,
		polygon: constants.ZERO_ADDRESS,
		bsc: constants.ZERO_ADDRESS,
		bsctest: constants.ZERO_ADDRESS,
		shibuya: constants.ZERO_ADDRESS,
		'moonbase-alphanet': constants.ZERO_ADDRESS,
		moonriver: constants.ZERO_ADDRESS,
		moonbeam: constants.ZERO_ADDRESS,
		'base-sepolia': constants.ZERO_ADDRESS,
		base: constants.ZERO_ADDRESS,
		sepolia: constants.ZERO_ADDRESS,
		// local : '0xEB4C2781e4ebA804CE9a9803C67d0893436bB27D', <-- fork
	},
	USDC_ERC20_ADDRESSES: {
		mainnet: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
		kovan: '0x98da9a82224E7A5896D6227382F7a52c82082146',
		goerli: '0x15040a4bDE0731664373Fb46Ce233262A644DFcd',
		rinkeby: '0x6bA629E9df8dC7f4039e0FfD1Ff8FF08b609d11C',
		ropsten: '0x7A7Ed4851B607811C10E51b5538203599437AAD3',
		mumbai: '0xcE954FC4c52A9E6e25306912A36eC59293da41E3',
		polygon: '0x2791bca1f2de4661ed88a30c99a7a9449aa84174', // 6 decimals
		bsc: '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d', // 18 decimals
		bsctest: '0x8EDc640693b518c8d531A8516A5C0Ae98b641a03',
		shibuya: '0xa6bEF2115B3a9EF9E00EF8162a24f866F9F50118',
		'moonbase-alphanet': '0xDF17D7AaCC4cE7f675d3600A07b3CEA843F3669f',
		moonriver: '0xE3F5a90F9cb311505cd691a46596599aA1A0AD7D', // 6 decimals
		moonbeam: '0x818ec0A7Fe18Ff94269904fCED6AE3DaE6d6dC0b', // 6 decimals
		'base-sepolia': '0xfec043ba43c733069cbc2243b36bc4fa33afcc28',
		base: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', // 6 decimals
		sepolia: '0x38d4e2EefDD05970f7d198F74E25D94e70D049D5', // 6 decimals
		// local : '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', <-- fork
	},
	DAI_ERC20_ADDRESSES: {
		mainnet: '0x6b175474e89094c44da98b954eedeac495271d0f',
		kovan: '0x39247f428F3A4ceAf40D4ED66809d02Ad016d3af',
		goerli: '0x7A95dE39F23e3Cf5B49dA829DA0fE39DaE39e4e8',
		rinkeby: '0x1d9602B83f02d57f35fA1767D2beecEB5FecDfa5',
		ropsten: '0xc3a0926dbBfFBDdD86BdbE2b0c115b6E5aAEDeE4',
		mumbai: '0xAcC78d249781EDb5feB50027971EF4D60f144325',
		polygon: '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063',
		bsc: '0x1af3f329e8be154074d8769d1ffa4ee058b1dbc3',
		bsctest: '0x52306d4521eFF70Ba555A578a66705b3352e8B3a',
		shibuya: '0xf9f6A3D3ED2b12483e271D92F68FcbC716BEba9F',
		'moonbase-alphanet': '0x33B86de94702C5Ff1ECba36D38Ea2Fc238894315',
		moonriver: '0x80A16016cC4A2E6a2CACA8a4a498b1699fF0f844',
		moonbeam: '0x06e605775296e851FF43b4dAa541Bb0984E9D6fD',
		'base-sepolia': '0x1AdC5b1bca919F59a00FC0fE8646C9e9C41338Eb',
		base: '0x50c5725949a6f0c72e6c4a641f24049a917db0cb',
		sepolia: '0x4ABf615437fb7eCE1b6702E57B23a7547F945545',
		// local : '0x6b175474e89094c44da98b954eedeac495271d0f', <-- fork
	},
	USDT_ERC20_ADDRESSES: {
		mainnet: '0xdac17f958d2ee523a2206206994597c13d831ec7', // 6 decimals
		kovan: constants.ZERO_ADDRESS,
		goerli: constants.ZERO_ADDRESS,
		rinkeby: constants.ZERO_ADDRESS,
		ropsten: constants.ZERO_ADDRESS,
		mumbai: '0xbf56f5Af97F6818f451F92ca917D8eeb87BbEc7c', // 6 decimals
		polygon: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', // 6 decimals
		bsc: '0x55d398326f99059ff775485246999027b3197955', // 18 decimals
		bsctest: constants.ZERO_ADDRESS,
		shibuya: constants.ZERO_ADDRESS,
		'moonbase-alphanet': '0x321449E0Be9798881e11925666aBaA324162930B', // 6 decimals
		moonbeam: '0xeFAeeE334F0Fd1712f9a8cc375f427D9Cdd40d73', // 6 decimals
		moonriver: '0xB44a9B6905aF7c801311e8F4E76932ee959c663C', // 6 decimals
		sepolia: '0x2436953d15Ae8b9119c787e1d50e393aFEe3426A', // 6 decimals
	},
	XAUT_ERC20_ADDRESSES: {
		mainnet: '0x68749665FF8D2d112Fa859AA293F07A622782F38', // 6 decimals
		kovan: constants.ZERO_ADDRESS,
		goerli: constants.ZERO_ADDRESS,
		rinkeby: constants.ZERO_ADDRESS,
		ropsten: constants.ZERO_ADDRESS,
		mumbai: '0xc20c3c3Ff7C418C6372287106b1668ae40c1bC39', // 6 decimals
		polygon: constants.ZERO_ADDRESS,
		bsc: constants.ZERO_ADDRESS,
		bsctest: constants.ZERO_ADDRESS,
		shibuya: constants.ZERO_ADDRESS,
		'moonbase-alphanet': '0xFA85FfEf4186339892557bb80E4F9C5F3E4df97f', // 6 decimals
		sepolia: '0x16B7Cf4F16608D76aEAD2b7b10f85090EfC7B746',
	},
	// USDbC_ERC20_ADDRESSES: {
	// 	base: '0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA',
	// 	'base-sepolia': '0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA',
	// },
	PAXG_ERC20_ADDRESSES: {
		mainnet: '0x45804880De22913dAFE09f4980848ECE6EcbAf78', // 18 decimals
		kovan: constants.ZERO_ADDRESS,
		goerli: constants.ZERO_ADDRESS,
		rinkeby: constants.ZERO_ADDRESS,
		ropsten: constants.ZERO_ADDRESS,
		mumbai: '0x644eAb1a0Ed9E034ad9eDFe75dbE67D614Fb7e7f', // 18 decimals
		polygon: '0x553d3D295e0f695B9228246232eDF400ed3560B5',
		bsc: '0x7950865a9140cB519342433146Ed5b40c6F210f7', // 18 decimals
		bsctest: '0xd3145aB4D7271740C1d4BdB0deD5CDEE0d08ee10', // 18 decimals
		shibuya: constants.ZERO_ADDRESS,
		'moonbase-alphanet': '0xE00A06E4938c015ba83F3AcB7B3499B36cf58502', // 18 decimals
		sepolia: '0x0567327A31A812344B71e6f95a64626EB72c1B22',
	},
	MINTER_ROLE_ADDRESS: {
		mainnet: '0x9923263fA127b3d1484cFD649df8f1831c2A74e4',
		kovan: constants.ZERO_ADDRESS,
		goerli: '0x37c3bfC05d5ebF9EBb3FF80ce0bd0133Bf221BC8',
		rinkeby: constants.ZERO_ADDRESS,
		ropsten: constants.ZERO_ADDRESS,
		mumbai: constants.ZERO_ADDRESS,
		polygon: constants.ZERO_ADDRESS,
		bsc: constants.ZERO_ADDRESS,
		bsctest: constants.ZERO_ADDRESS,
		shibuya: constants.ZERO_ADDRESS,
		'moonbase-alphanet': constants.ZERO_ADDRESS,
		moonriver: constants.ZERO_ADDRESS,
		moonbeam: constants.ZERO_ADDRESS,
		'base-sepolia': constants.ZERO_ADDRESS,
		base: constants.ZERO_ADDRESS,
		sepolia: constants.ZERO_ADDRESS,
		local: '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266',
	},
	DEBT_MANAGER_ADDRESS: {
		mainnet: '0xB0Cc90f912a4f0161D2e104B0aF4b2Ff35d9C586',
		kovan: '0xB0Cc90f912a4f0161D2e104B0aF4b2Ff35d9C586',
		goerli: '0xB0Cc90f912a4f0161D2e104B0aF4b2Ff35d9C586',
		rinkeby: '0xB0Cc90f912a4f0161D2e104B0aF4b2Ff35d9C586',
		ropsten: '0xB0Cc90f912a4f0161D2e104B0aF4b2Ff35d9C586',
		mumbai: '0xB0Cc90f912a4f0161D2e104B0aF4b2Ff35d9C586',
		polygon: '0xB0Cc90f912a4f0161D2e104B0aF4b2Ff35d9C586',
		bsc: '0xB0Cc90f912a4f0161D2e104B0aF4b2Ff35d9C586',
		bsctest: '0xB0Cc90f912a4f0161D2e104B0aF4b2Ff35d9C586',
		shibuya: '0xB0Cc90f912a4f0161D2e104B0aF4b2Ff35d9C586',
		'moonbase-alphanet': '0xB0Cc90f912a4f0161D2e104B0aF4b2Ff35d9C586',
		moonriver: '0xB0Cc90f912a4f0161D2e104B0aF4b2Ff35d9C586',
		moonbeam: '0xB0Cc90f912a4f0161D2e104B0aF4b2Ff35d9C586',
		'base-sepolia': '0xB0Cc90f912a4f0161D2e104B0aF4b2Ff35d9C586',
		base: '0xB0Cc90f912a4f0161D2e104B0aF4b2Ff35d9C586',
		sepolia: '0xB0Cc90f912a4f0161D2e104B0aF4b2Ff35d9C586',
		local: '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266',
	},
	INFLATION_MINTER_ADDRESS: {
		mainnet: '0xf18723b4CB5cDE1eC7733c75686dA63aF285d77c',
		kovan: '0xf18723b4CB5cDE1eC7733c75686dA63aF285d77c',
		goerli: '0xf18723b4CB5cDE1eC7733c75686dA63aF285d77c',
		rinkeby: '0xf18723b4CB5cDE1eC7733c75686dA63aF285d77c',
		ropsten: '0xf18723b4CB5cDE1eC7733c75686dA63aF285d77c',
		mumbai: '0xf18723b4CB5cDE1eC7733c75686dA63aF285d77c',
		polygon: '0xf18723b4CB5cDE1eC7733c75686dA63aF285d77c',
		bsc: '0xf18723b4CB5cDE1eC7733c75686dA63aF285d77c',
		bsctest: '0xf18723b4CB5cDE1eC7733c75686dA63aF285d77c',
		shibuya: '0xf18723b4CB5cDE1eC7733c75686dA63aF285d77c',
		'moonbase-alphanet': '0xf18723b4CB5cDE1eC7733c75686dA63aF285d77c',
		moonriver: '0xf18723b4CB5cDE1eC7733c75686dA63aF285d77c',
		moonbeam: '0xf18723b4CB5cDE1eC7733c75686dA63aF285d77c',
		'base-sepolia': '0xf18723b4CB5cDE1eC7733c75686dA63aF285d77c',
		base: '0xf18723b4CB5cDE1eC7733c75686dA63aF285d77c',
		sepolia: '0xf18723b4CB5cDE1eC7733c75686dA63aF285d77c',
		local: '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266',
	},
	ORACLE_ADDRESS: {
		mainnet: '0x942b636Fdc89F133FF67EaB67fE7630c0A095e91',
		kovan: '0x942b636Fdc89F133FF67EaB67fE7630c0A095e91',
		goerli: '0x942b636Fdc89F133FF67EaB67fE7630c0A095e91',
		rinkeby: '0x942b636Fdc89F133FF67EaB67fE7630c0A095e91',
		ropsten: '0x942b636Fdc89F133FF67EaB67fE7630c0A095e91',
		mumbai: '0x942b636Fdc89F133FF67EaB67fE7630c0A095e91',
		polygon: '0x942b636Fdc89F133FF67EaB67fE7630c0A095e91',
		bsc: '0x942b636Fdc89F133FF67EaB67fE7630c0A095e91',
		bsctest: '0x942b636Fdc89F133FF67EaB67fE7630c0A095e91',
		shibuya: '0x942b636Fdc89F133FF67EaB67fE7630c0A095e91',
		'moonbase-alphanet': '0x942b636Fdc89F133FF67EaB67fE7630c0A095e91',
		moonriver: '0x942b636Fdc89F133FF67EaB67fE7630c0A095e91',
		moonbeam: '0x942b636Fdc89F133FF67EaB67fE7630c0A095e91',
		'base-sepolia': '0x942b636Fdc89F133FF67EaB67fE7630c0A095e91',
		base: '0x942b636Fdc89F133FF67EaB67fE7630c0A095e91',
		sepolia: '0x942b636Fdc89F133FF67EaB67fE7630c0A095e91',
		local: '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266',
	},
	CHILD_CHAIN_MANAGER_ADDRESS: {
		mainnet: constants.ZERO_ADDRESS,
		kovan: constants.ZERO_ADDRESS,
		goerli: constants.ZERO_ADDRESS,
		rinkeby: constants.ZERO_ADDRESS,
		ropsten: constants.ZERO_ADDRESS,
		mumbai: '0x981Ca3e19AB02f758f252611bb5881AA4ECEDB3B',
		polygon: '0x981Ca3e19AB02f758f252611bb5881AA4ECEDB3B',
		bsc: constants.ZERO_ADDRESS,
		bsctest: constants.ZERO_ADDRESS,
		'moonbase-alphanet': constants.ZERO_ADDRESS,
		moonriver: constants.ZERO_ADDRESS,
		moonbeam: constants.ZERO_ADDRESS,
		'base-sepolia': '0x981Ca3e19AB02f758f252611bb5881AA4ECEDB3B',
		base: '0x981Ca3e19AB02f758f252611bb5881AA4ECEDB3B',
		sepolia: constants.ZERO_ADDRESS,
	},
	BRIDGE_ROLES: {
		mainnet: [{ roleKey: 'Validator', address: '0x02fdB92329f52D9E3B4582700Fa4d493AB50d77f' }],
		kovan: [{ roleKey: 'Validator', address: '0x02fdB92329f52D9E3B4582700Fa4d493AB50d77f' }],
		ropsten: [{ roleKey: 'Validator', address: '0x02fdB92329f52D9E3B4582700Fa4d493AB50d77f' }],
		rinkeby: [{ roleKey: 'Validator', address: '0x02fdB92329f52D9E3B4582700Fa4d493AB50d77f' }],
		bsc: [{ roleKey: 'Validator', address: '0x02fdB92329f52D9E3B4582700Fa4d493AB50d77f' }],
		bsctest: [{ roleKey: 'Validator', address: '0x02fdB92329f52D9E3B4582700Fa4d493AB50d77f' }],
		mumbai: [{ roleKey: 'Validator', address: '0x02fdB92329f52D9E3B4582700Fa4d493AB50d77f' }],
		polygon: [{ roleKey: 'Validator', address: '0x02fdB92329f52D9E3B4582700Fa4d493AB50d77f' }],
		goerli: [{ roleKey: 'Validator', address: '0x02fdB92329f52D9E3B4582700Fa4d493AB50d77f' }],
		local: [{ roleKey: 'Validator', address: '0x02fdB92329f52D9E3B4582700Fa4d493AB50d77f' }],
		'moonbase-alphanet': [
			{ roleKey: 'Validator', address: '0x02fdB92329f52D9E3B4582700Fa4d493AB50d77f' },
		],
		moonriver: [{ roleKey: 'Validator', address: '0x02fdB92329f52D9E3B4582700Fa4d493AB50d77f' }],
		moonbeam: [{ roleKey: 'Validator', address: '0x02fdB92329f52D9E3B4582700Fa4d493AB50d77f' }],
		'base-sepolia': [
			{ roleKey: 'Validator', address: '0x02fdB92329f52D9E3B4582700Fa4d493AB50d77f' },
		],
		base: [{ roleKey: 'Validator', address: '0x02fdB92329f52D9E3B4582700Fa4d493AB50d77f' }],
		sepolia: [{ roleKey: 'Validator', address: '0x02fdB92329f52D9E3B4582700Fa4d493AB50d77f' }],
	},
	BRIDGE_NETWORK_STATUS: {
		mainnet: [
			{ network: 'bsc', isOpened: true },
			{ network: 'polygon', isOpened: true },
			{ network: 'moonriver', isOpened: true },
			{ network: 'moonbeam', isOpened: true },
			{ network: 'base', isOpened: true },
		],
		bsc: [
			{ network: 'mainnet', isOpened: true },
			{ network: 'polygon', isOpened: true },
			{ network: 'moonriver', isOpened: true },
			{ network: 'moonbeam', isOpened: true },
			{ network: 'base', isOpened: true },
		],
		polygon: [
			{ network: 'mainnet', isOpened: true },
			{ network: 'bsc', isOpened: true },
			{ network: 'moonriver', isOpened: true },
			{ network: 'moonbeam', isOpened: true },
			{ network: 'base', isOpened: true },
		],
		moonriver: [
			{ network: 'mainnet', isOpened: true },
			{ network: 'bsc', isOpened: true },
			{ network: 'polygon', isOpened: true },
			{ network: 'moonbeam', isOpened: true },
			{ network: 'base', isOpened: true },
		],
		moonbeam: [
			{ network: 'mainnet', isOpened: true },
			{ network: 'bsc', isOpened: true },
			{ network: 'polygon', isOpened: true },
			{ network: 'moonriver', isOpened: true },
			{ network: 'base', isOpened: true },
		],
		base: [
			{ network: 'mainnet', isOpened: true },
			{ network: 'bsc', isOpened: true },
			{ network: 'polygon', isOpened: true },
			{ network: 'moonriver', isOpened: true },
			{ network: 'moonbeam', isOpened: true },
		],
		sepolia: [
			{ network: 'base-sepolia', isOpened: true },
			{ network: 'bsctest', isOpened: true },
			{ network: 'mumbai', isOpened: true },
			{ network: 'moonbase-alphanet', isOpened: true },
		],
		kovan: [
			{ network: 'bsctest', isOpened: true },
			{ network: 'mumbai', isOpened: true },
			{ network: 'moonbase-alphanet', isOpened: true },
		],
		rinkeby: [{ network: 'moonbase-alphanet', isOpened: true }],
		ropsten: [{ network: 'moonbase-alphanet', isOpened: true }],
		bsctest: [
			{ network: 'sepolia', isOpened: true },
			{ network: 'mumbai', isOpened: true },
			{ network: 'moonbase-alphanet', isOpened: true },
			{ network: 'base-sepolia', isOpened: true },
		],
		mumbai: [
			{ network: 'bsctest', isOpened: true },
			{ network: 'sepolia', isOpened: true },
			{ network: 'moonbase-alphanet', isOpened: true },
			{ network: 'base-sepolia', isOpened: true },
		],
		goerli: [{ network: 'moonbase-alphanet', isOpened: true }],
		'moonbase-alphanet': [
			{ network: 'bsctest', isOpened: true },
			{ network: 'sepolia', isOpened: true },
			{ network: 'mumbai', isOpened: true },
			{ network: 'base-sepolia', isOpened: true },
		],
		'base-sepolia': [
			{ network: 'moonbase-alphanet', isOpened: true },
			{ network: 'mumbai', isOpened: true },
			{ network: 'bsctest', isOpened: true },
			{ network: 'sepolia', isOpened: true },
		],
		local: [
			{ network: 'mumbai', isOpened: true },
			{ network: 'bsctest', isOpened: true },
			{ network: 'sepolia', isOpened: true },
			{ network: 'moonbase-alphanet', isOpened: true },
		],
	},
	CROSS_DOMAIN_DEPOSIT_GAS_LIMIT: `${3e6}`,
	CROSS_DOMAIN_ESCROW_GAS_LIMIT: `${8e6}`,
	CROSS_DOMAIN_REWARD_GAS_LIMIT: `${3e6}`,
	CROSS_DOMAIN_WITHDRAWAL_GAS_LIMIT: `${3e6}`,
	COLLATERAL_MANAGER: {
		PYNTHS: ['pUSD', 'pBTC', 'pETH'],
		SHORTS: [
			{ long: 'pBTC', short: 'iBTC' },
			{ long: 'pETH', short: 'iETH' },
		],
		MAX_DEBT: w3utils.toWei('50000000'), // 50 million pUSD
		BASE_BORROW_RATE: Math.round((0.005 * 1e18) / 31556926).toString(), // 31556926 is CollateralManager seconds per year
		BASE_SHORT_RATE: Math.round((0.005 * 1e18) / 31556926).toString(),
	},
	COLLATERAL_ETH: {
		PYNTHS: ['pUSD', 'pETH'],
		MIN_CRATIO: w3utils.toWei('1.3'),
		MIN_COLLATERAL: w3utils.toWei('2'),
		ISSUE_FEE_RATE: w3utils.toWei('0.001'),
	},
	COLLATERAL_RENBTC: {
		PYNTHS: ['pUSD', 'pBTC'],
		MIN_CRATIO: w3utils.toWei('1.3'),
		MIN_COLLATERAL: w3utils.toWei('0.05'),
		ISSUE_FEE_RATE: w3utils.toWei('0.001'),
	},
	COLLATERAL_SHORT: {
		PYNTHS: ['pBTC', 'pETH'],
		MIN_CRATIO: w3utils.toWei('1.2'),
		MIN_COLLATERAL: w3utils.toWei('1000'),
		ISSUE_FEE_RATE: w3utils.toWei('0.005'),
		INTERACTION_DELAY: '3600', // 1 hour in secs
	},
};

/**
 * Converts a string into a hex representation of bytes32, with right padding
 */
const toBytes32 = key => w3utils.rightPad(w3utils.asciiToHex(key), 64);
const fromBytes32 = key => w3utils.hexToAscii(key);

const getFolderNameForNetwork = ({ network, useOvm = false }) => {
	if (network.includes('ovm')) {
		return network;
	}

	return useOvm ? `${network}-ovm` : network;
};

const getPathToNetwork = ({ network = 'mainnet', file = '', useOvm = false, path } = {}) =>
	path.join(__dirname, 'publish', 'deployed', getFolderNameForNetwork({ network, useOvm }), file);

// Pass in fs and path to avoid webpack wrapping those
const loadDeploymentFile = ({ network, path, fs, deploymentPath, useOvm = false }) => {
	if (!deploymentPath && network !== 'local' && (!path || !fs)) {
		return data[getFolderNameForNetwork({ network, useOvm })].deployment;
	}
	const pathToDeployment = deploymentPath
		? path.join(deploymentPath, constants.DEPLOYMENT_FILENAME)
		: getPathToNetwork({ network, useOvm, path, file: constants.DEPLOYMENT_FILENAME });

	if (!fs.existsSync(pathToDeployment)) {
		throw Error(`Cannot find deployment for network: ${network}.`);
	}
	return JSON.parse(fs.readFileSync(pathToDeployment));
};

/**
 * Retrieve the list of targets for the network - returning the name, address, source file and link to etherscan
 */
const getTarget = ({
	network = 'mainnet',
	useOvm = false,
	contract,
	path,
	fs,
	deploymentPath,
} = {}) => {
	const deployment = loadDeploymentFile({ network, useOvm, path, fs, deploymentPath });
	if (contract) return deployment.targets[contract];
	else return deployment.targets;
};

/**
 * Retrieve the list of solidity sources for the network - returning the abi and bytecode
 */
const getSource = ({
	network = 'mainnet',
	useOvm = false,
	contract,
	path,
	fs,
	deploymentPath,
} = {}) => {
	const deployment = loadDeploymentFile({ network, useOvm, path, fs, deploymentPath });
	if (contract) return deployment.sources[contract];
	else return deployment.sources;
};

/**
 * Retrieve the ASTs for the source contracts
 */
const getAST = ({ source, path, fs, match = /^contracts\// } = {}) => {
	let fullAST;
	if (path && fs) {
		const pathToAST = path.resolve(
			__dirname,
			constants.BUILD_FOLDER,
			constants.AST_FOLDER,
			constants.AST_FILENAME
		);
		if (!fs.existsSync(pathToAST)) {
			throw Error('Cannot find AST');
		}
		fullAST = JSON.parse(fs.readFileSync(pathToAST));
	} else {
		// Note: The below cannot be required as the build folder is not stored
		// in code (only in the published module).
		// The solution involves tracking these after each commit in another file
		// somewhere persisted in the codebase - JJM
		// 		data.ast = require('./build/ast/asts.json'),
		if (!data.ast) {
			throw Error('AST currently not supported in browser mode');
		}
		fullAST = data.ast;
	}

	// remove anything not matching the pattern
	const ast = Object.entries(fullAST)
		.filter(([astEntryKey]) => match.test(astEntryKey))
		.reduce((memo, [key, val]) => {
			memo[key] = val;
			return memo;
		}, {});

	if (source && source in ast) {
		return ast[source];
	} else if (source) {
		// try to find the source without a path
		const [key, entry] =
			Object.entries(ast).find(([astEntryKey]) => astEntryKey.includes('/' + source)) || [];
		if (!key || !entry) {
			throw Error(`Cannot find AST entry for source: ${source}`);
		}
		return { [key]: entry };
	} else {
		return ast;
	}
};

const getFeeds = ({ network, path, fs, deploymentPath, useOvm = false } = {}) => {
	let feeds;

	if (!deploymentPath && network !== 'local' && (!path || !fs)) {
		feeds = data[getFolderNameForNetwork({ network, useOvm })].feeds;
	} else {
		const pathToFeeds = deploymentPath
			? path.join(deploymentPath, constants.FEEDS_FILENAME)
			: getPathToNetwork({
					network,
					path,
					useOvm,
					file: constants.FEEDS_FILENAME,
			  });
		if (!fs.existsSync(pathToFeeds)) {
			throw Error(`Cannot find feeds file.`);
		}
		feeds = JSON.parse(fs.readFileSync(pathToFeeds));
	}

	const pynths = getPynths({ network, useOvm, path, fs, deploymentPath, skipPopulate: true });

	// now mix in the asset data
	return Object.entries(feeds).reduce((memo, [asset, entry]) => {
		memo[asset] = Object.assign(
			// standalone feeds are those without a pynth using them
			// Note: ETH still used as a rate for Depot, can remove the below once the Depot uses pETH rate or is
			// removed from the system
			{ standalone: !pynths.find(pynth => pynth.asset === asset) || asset === 'ETH' },
			assets[asset],
			entry
		);
		return memo;
	}, {});
};

/**
 * Retrieve ths list of pynths for the network - returning their names, assets underlying, category, sign, description, and
 * optional index and inverse properties
 */
const getPynths = ({
	network = 'mainnet',
	path,
	fs,
	deploymentPath,
	useOvm = false,
	skipPopulate = false,
} = {}) => {
	let pynths;

	if (!deploymentPath && network !== 'local' && (!path || !fs)) {
		pynths = data[getFolderNameForNetwork({ network, useOvm })].pynths;
	} else {
		const pathToPynthList = deploymentPath
			? path.join(deploymentPath, constants.PYNTHS_FILENAME)
			: getPathToNetwork({ network, useOvm, path, file: constants.PYNTHS_FILENAME });
		if (!fs.existsSync(pathToPynthList)) {
			throw Error(`Cannot find pynth list.`);
		}
		pynths = JSON.parse(fs.readFileSync(pathToPynthList));
	}

	if (skipPopulate) {
		return pynths;
	}

	const feeds = getFeeds({ network, useOvm, path, fs, deploymentPath });

	// copy all necessary index parameters from the longs to the corresponding shorts
	return pynths.map(pynth => {
		// mixin the asset details
		pynth = Object.assign({}, assets[pynth.asset], pynth);

		if (feeds[pynth.asset]) {
			const { feed } = feeds[pynth.asset];

			pynth = Object.assign({ feed }, pynth);
		}

		if (pynth.inverted) {
			pynth.description = `Inverse ${pynth.description}`;
		}
		// replace an index placeholder with the index details
		if (typeof pynth.index === 'string') {
			const { index } = pynths.find(({ name }) => name === pynth.index) || {};
			if (!index) {
				throw Error(
					`While processing ${pynth.name}, it's index mapping "${pynth.index}" cannot be found - this is an error in the deployment config and should be fixed`
				);
			}
			pynth = Object.assign({}, pynth, { index });
		}

		if (pynth.index) {
			pynth.index = pynth.index.map(indexEntry => {
				return Object.assign({}, assets[indexEntry.asset], indexEntry);
			});
		}

		return pynth;
	});
};

/**
 * Retrieve the list of staking rewards for the network - returning this names, stakingToken, and rewardToken
 */
const getStakingRewards = ({
	network = 'mainnet',
	useOvm = false,
	path,
	fs,
	deploymentPath,
} = {}) => {
	if (!deploymentPath && network !== 'local' && (!path || !fs)) {
		return data[getFolderNameForNetwork({ network, useOvm })].rewards;
	}

	const pathToStakingRewardsList = deploymentPath
		? path.join(deploymentPath, constants.STAKING_REWARDS_FILENAME)
		: getPathToNetwork({
				network,
				path,
				useOvm,
				file: constants.STAKING_REWARDS_FILENAME,
		  });
	if (!fs.existsSync(pathToStakingRewardsList)) {
		return [];
	}
	return JSON.parse(fs.readFileSync(pathToStakingRewardsList));
};

/**
 * Retrieve the list of shorting rewards for the network - returning the names and rewardTokens
 */
const getShortingRewards = ({
	network = 'mainnet',
	useOvm = false,
	path,
	fs,
	deploymentPath,
} = {}) => {
	if (!deploymentPath && network !== 'local' && (!path || !fs)) {
		return data[getFolderNameForNetwork({ network, useOvm })]['shorting-rewards'];
	}

	const pathToShortingRewardsList = deploymentPath
		? path.join(deploymentPath, constants.SHORTING_REWARDS_FILENAME)
		: getPathToNetwork({
				network,
				path,
				useOvm,
				file: constants.SHORTING_REWARDS_FILENAME,
		  });
	if (!fs.existsSync(pathToShortingRewardsList)) {
		return [];
	}
	return JSON.parse(fs.readFileSync(pathToShortingRewardsList));
};

/**
 * Retrieve the list of system user addresses
 */
const getUsers = ({ network = 'mainnet', user, useOvm = false } = {}) => {
	const testnetOwner = '0x166220468aff631290b7E1Ddff7F45b052De8324';
	const base = {
		owner: testnetOwner,
		deployer: testnetOwner,
		marketClosure: testnetOwner,
		oracle: '0x942b636Fdc89F133FF67EaB67fE7630c0A095e91',
		fee: '0xfeEFEEfeefEeFeefEEFEEfEeFeefEEFeeFEEFEeF',
		zero: '0x' + '0'.repeat(40),
	};

	const map = {
		mainnet: Object.assign({}, base, {
			owner: '0x615825D7d3ca35c251019bC6d89947D0b03630E7',
			deployer: '0x615825D7d3ca35c251019bC6d89947D0b03630E7',
		}),
		kovan: Object.assign({}, base),
		// 'kovan-ovm': Object.assign({}, base),
		// 'mainnet-ovm': Object.assign({}, base, {
		//	owner: '0x615825D7d3ca35c251019bC6d89947D0b03630E7',
		// }),
		rinkeby: Object.assign({}, base),
		ropsten: Object.assign({}, base),
		goerli: Object.assign({}, base),
		// 'goerli-ovm': Object.assign({}, base),
		local: Object.assign({}, base, {
			// Deterministic account #0 when using `npx hardhat node`
			owner: '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266',
		}),
		mumbai: Object.assign({}, base),
		moonriver: Object.assign({}, base),
		polygon: Object.assign({}, base, {
			owner: '0x615825D7d3ca35c251019bC6d89947D0b03630E7',
			deployer: '0x615825D7d3ca35c251019bC6d89947D0b03630E7',
		}),
		bsc: Object.assign({}, base, {
			owner: '0x615825D7d3ca35c251019bC6d89947D0b03630E7',
			deployer: '0x615825D7d3ca35c251019bC6d89947D0b03630E7',
		}),
	};

	const users = Object.entries(
		map[getFolderNameForNetwork({ network, useOvm })]
	).map(([key, value]) => ({ name: key, address: value }));

	return user ? users.find(({ name }) => name === user) : users;
};

const getVersions = ({
	network = 'mainnet',
	path,
	fs,
	deploymentPath,
	useOvm,
	byContract = false,
} = {}) => {
	let versions;

	if (!deploymentPath && network !== 'local' && (!path || !fs)) {
		versions = data[getFolderNameForNetwork({ network, useOvm })].versions;
	} else {
		const pathToVersions = deploymentPath
			? path.join(deploymentPath, constants.VERSIONS_FILENAME)
			: getPathToNetwork({ network, useOvm, path, file: constants.VERSIONS_FILENAME });
		if (!fs.existsSync(pathToVersions)) {
			throw Error(`Cannot find versions for network.`);
		}
		versions = JSON.parse(fs.readFileSync(pathToVersions));
	}

	if (byContract) {
		// compile from the contract perspective
		return Object.values(versions).reduce(
			(memo, { tag, release, date, commit, block, contracts }) => {
				for (const [contract, contractEntry] of Object.entries(contracts)) {
					memo[contract] = memo[contract] || [];
					memo[contract].push(Object.assign({ tag, release, date, commit, block }, contractEntry));
				}
				return memo;
			},
			{}
		);
	}
	return versions;
};

const getSuspensionReasons = ({ code = undefined } = {}) => {
	const suspensionReasonMap = {
		1: 'System Upgrade',
		2: 'Market Closure',
		4: 'iPynth Reprice',
		55: 'Circuit Breaker (Phase one)', // https://sips.peri.finance/SIPS/sip-55
		65: 'Decentralized Circuit Breaker (Phase two)', // https://sips.peri.finance/SIPS/sip-65
		99999: 'Emergency',
	};

	return code ? suspensionReasonMap[code] : suspensionReasonMap;
};

/**
 * Retrieve the list of tokens used in the Peri Finance protocol
 */
const getTokens = ({ network = 'mainnet', path, fs, useOvm = false } = {}) => {
	const pynths = getPynths({ network, useOvm, path, fs });
	const targets = getTarget({ network, useOvm, path, fs });
	const feeds = getFeeds({ network, useOvm, path, fs });

	return [
		Object.assign(
			{
				symbol: 'PERI',
				asset: 'PERI',
				name: 'PeriFinance',
				address: targets.ProxyERC20.address,
				decimals: 18,
			},
			feeds['PERI'].feed ? { feed: feeds['PERI'].feed } : {}
		),
	].concat(
		pynths
			.filter(({ category }) => category !== 'internal')
			.map(pynth => ({
				symbol: pynth.name,
				asset: pynth.asset,
				name: pynth.description,
				address: (targets[`Proxy${pynth.name === 'pUSD' ? 'ERC20pUSD' : pynth.name}`] || {})
					.address,
				index: pynth.index,
				inverted: pynth.inverted,
				decimals: 18,
				feed: pynth.feed,
			}))
			.sort((a, b) => (a.symbol > b.symbol ? 1 : -1))
	);
};

const decode = ({ network = 'mainnet', fs, path, data, target, useOvm = false } = {}) => {
	const sources = getSource({ network, path, fs, useOvm });
	for (const { abi } of Object.values(sources)) {
		abiDecoder.addABI(abi);
	}
	const targets = getTarget({ network, path, fs, useOvm });
	let contract;
	if (target) {
		contract = Object.values(targets).filter(
			({ address }) => address.toLowerCase() === target.toLowerCase()
		)[0].name;
	}
	return { method: abiDecoder.decodeMethod(data), contract };
};

const wrap = ({ network, deploymentPath, fs, path, useOvm = false }) =>
	[
		'decode',
		'getAST',
		'getPathToNetwork',
		'getSource',
		'getStakingRewards',
		'getShortingRewards',
		'getFeeds',
		'getPynths',
		'getTarget',
		'getTokens',
		'getUsers',
		'getVersions',
	].reduce((memo, fnc) => {
		memo[fnc] = (prop = {}) =>
			module.exports[fnc](Object.assign({ network, deploymentPath, fs, path, useOvm }, prop));
		return memo;
	}, {});

module.exports = {
	chainIdMapping,
	constants,
	decode,
	defaults,
	getAST,
	getNetworkFromId,
	getPathToNetwork,
	getSource,
	getStakingRewards,
	getShortingRewards,
	getSuspensionReasons,
	getFeeds,
	getPynths,
	getTarget,
	getTokens,
	getUsers,
	getVersions,
	networks,
	networkToChainId,
	toBytes32,
	fromBytes32,
	wrap,
	ovmIgnored,
	nonUpgradeable,
	releases,
	knownAccounts,
};
