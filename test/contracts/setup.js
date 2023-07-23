'use strict';

const { artifacts, web3, log } = require('hardhat');

const { toWei } = web3.utils;
const { toUnit } = require('../utils')();
const { setupPriceAggregators, updateAggregatorRates } = require('./helpers');
const {
	toBytes32,
	// fromBytes32,
	getUsers,
	constants: { ZERO_ADDRESS },
	defaults: {
		WAITING_PERIOD_SECS,
		PRICE_DEVIATION_THRESHOLD_FACTOR,
		ISSUANCE_RATIO,
		MAX_EXTERNAL_TOKEN_QUOTA,
		FEE_PERIOD_DURATION,
		TARGET_THRESHOLD,
		LIQUIDATION_DELAY,
		LIQUIDATION_RATIO,
		LIQUIDATION_ESCROW_DURATION,
		LIQUIDATION_PENALTY,
		PERI_LIQUIDATION_PENALTY,
		SELF_LIQUIDATION_PENALTY,
		FLAG_REWARD,
		LIQUIDATE_REWARD,
		RATE_STALE_PERIOD,
		MINIMUM_STAKE_TIME,
		DEBT_SNAPSHOT_STALE_TIME,
		CROSS_DOMAIN_DEPOSIT_GAS_LIMIT,
		CROSS_DOMAIN_REWARD_GAS_LIMIT,
		CROSS_DOMAIN_ESCROW_GAS_LIMIT,
		CROSS_DOMAIN_WITHDRAWAL_GAS_LIMIT,
	},
} = require('../../');

const SUPPLY_100M = toWei((1e8).toString()); // 100M

/**
 * Create a mock ExternStateToken - useful to mock PeriFinance or a pynth
 */
const mockToken = async ({
	accounts,
	pynth = undefined,
	name = 'name',
	symbol = 'ABC',
	supply = 1e8,
	skipInitialAllocation = false,
}) => {
	const [deployerAccount, owner] = accounts;

	const totalSupply = toWei(supply.toString());

	const proxy = await artifacts.require('ProxyERC20').new(owner, { from: deployerAccount });
	// set associated contract as deployerAccount so we can setBalanceOf to the owner below
	const tokenState = await artifacts
		.require('TokenState')
		.new(owner, deployerAccount, { from: deployerAccount });

	if (!skipInitialAllocation && supply > 0) {
		await tokenState.setBalanceOf(owner, totalSupply, { from: deployerAccount });
	}

	const bridgeState = await artifacts
		.require('BridgeState')
		.new(owner, deployerAccount, { from: deployerAccount });

	const token = await artifacts.require(pynth ? 'MockPynth' : 'PublicEST').new(
		...[proxy.address, tokenState.address, name, symbol, totalSupply, owner]
			// add pynth as currency key if needed
			.concat(pynth ? toBytes32(pynth) : [])
			.concat({
				from: deployerAccount,
			})
	);
	await Promise.all([
		tokenState.setAssociatedContract(token.address, { from: owner }),
		proxy.setTarget(token.address, { from: owner }),
	]);

	return { token, tokenState, proxy, bridgeState };
};

const mockGenericContractFnc = async ({ instance, fncName, mock, returns = [] }) => {
	// Adapted from: https://github.com/EthWorks/Doppelganger/blob/master/lib/index.ts
	const abiEntryForFnc = artifacts.require(mock).abi.find(({ name }) => name === fncName);

	if (!fncName || !abiEntryForFnc) {
		throw Error(`Cannot find function "${fncName}" in the ABI of contract "${mock}"`);
	}
	const signature = web3.eth.abi.encodeFunctionSignature(abiEntryForFnc);

	const outputTypes = abiEntryForFnc.outputs.map(({ type }) => type);

	const responseAsEncodedData = web3.eth.abi.encodeParameters(outputTypes, returns);

	if (process.env.DEBUG) {
		log(`Mocking ${mock}.${fncName} to return ${returns.join(',')}`);
	}

	await instance.mockReturns(signature, responseAsEncodedData);
};

/**
 * Setup an individual contract. Note: will fail if required dependencies aren't provided in the cache.
 */
const setupContract = async ({
	accounts,
	contract,
	source = undefined, // if a separate source file should be used
	mock = undefined, // if contract is GenericMock, this is the name of the contract being mocked
	forContract = undefined, // when a contract is deployed for another (like Proxy for FeePool)
	cache = {},
	args = [],
	skipPostDeploy = false,
	properties = {},
}) => {
	const [deployerAccount, owner, oracle, fundsWallet, debtManager, , , , , minterRole] = accounts;

	const artifact = artifacts.require(source || contract);

	const create = ({ constructorArgs }) => {
		return artifact.new(
			...constructorArgs.concat({
				from: deployerAccount,
			})
		);
	};

	// if it needs library linking
	if (Object.keys((await artifacts.readArtifact(source || contract)).linkReferences).length > 0) {
		await artifact.link(await artifacts.require('SafeDecimalMath').new());
	}

	const tryGetAddressOf = name => (cache[name] ? cache[name].address : ZERO_ADDRESS);

	const tryGetProperty = ({ property, otherwise }) =>
		property in properties ? properties[property] : otherwise;

	const tryInvocationIfNotMocked = ({ name, fncName, args, user = owner }) => {
		if (name in cache && fncName in cache[name]) {
			if (process.env.DEBUG) {
				log(`Invoking ${name}.${fncName}(${args.join(',')})`);
			}

			return cache[name][fncName](...args.concat({ from: user }));
		}
	};

	const defaultArgs = {
		GenericMock: [],
		PeriFinanceBridgeToOptimism: [owner, tryGetAddressOf('AddressResolver')],
		PeriFinanceBridgeToBase: [owner, tryGetAddressOf('AddressResolver')],
		TradingRewards: [owner, owner, tryGetAddressOf('AddressResolver')],
		AddressResolver: [owner],
		SystemStatus: [owner],
		FlexibleStorage: [tryGetAddressOf('AddressResolver')],
		ExchangeRates: [
			owner,
			oracle,
			tryGetAddressOf('AddressResolver'),
			[toBytes32('PERI'), toBytes32('USDC')],
			[toWei('0.2', 'ether'), toWei('0.98', 'ether')],
		],
		PeriFinanceState: [owner, ZERO_ADDRESS],
		SupplySchedule: [owner, 0, 0],
		Proxy: [owner],
		ProxyERC20: [owner],
		Depot: [owner, fundsWallet, tryGetAddressOf('AddressResolver')],
		PynthUtil: [tryGetAddressOf('AddressResolver')],
		DappMaintenance: [owner],
		DebtCache: [owner, tryGetAddressOf('AddressResolver')],
		Issuer: [owner, tryGetAddressOf('AddressResolver')],
		Exchanger: [owner, tryGetAddressOf('AddressResolver')],
		SystemSettings: [owner, tryGetAddressOf('AddressResolver')],
		ExchangeState: [owner, tryGetAddressOf('Exchanger')],
		BasePeriFinance: [
			tryGetAddressOf('ProxyERC20BasePeriFinance'),
			tryGetAddressOf('TokenStateBasePeriFinance'),
			owner,
			SUPPLY_100M,
			tryGetAddressOf('AddressResolver'),
			tryGetAddressOf('BlacklistManager'),
		],
		PeriFinance: [
			tryGetAddressOf('ProxyERC20PeriFinance'),
			tryGetAddressOf('TokenStatePeriFinance'),
			owner,
			SUPPLY_100M,
			tryGetAddressOf('AddressResolver'),
			owner,
			tryGetAddressOf('BlacklistManager'),
			debtManager,
		],
		MintablePeriFinance: [
			tryGetAddressOf('ProxyERC20MintablePeriFinance'),
			tryGetAddressOf('TokenStateMintablePeriFinance'),
			owner,
			SUPPLY_100M,
			tryGetAddressOf('AddressResolver'),
			tryGetAddressOf('BlacklistManager'),
		],
		RewardsDistribution: [
			owner,
			tryGetAddressOf('PeriFinance'),
			tryGetAddressOf('ProxyERC20PeriFinance'),
			tryGetAddressOf('RewardEscrowV2'),
			tryGetAddressOf('ProxyFeePool'),
		],
		RewardEscrow: [owner, tryGetAddressOf('PeriFinance'), tryGetAddressOf('FeePool')],
		BaseRewardEscrowV2: [owner, tryGetAddressOf('AddressResolver')],
		RewardEscrowV2: [owner, tryGetAddressOf('AddressResolver')],
		ImportableRewardEscrowV2: [owner, tryGetAddressOf('AddressResolver')],
		PeriFinanceEscrow: [owner, tryGetAddressOf('PeriFinance'), owner],
		// use deployerAccount as associated contract to allow it to call setBalanceOf()
		TokenState: [owner, deployerAccount],
		EtherCollateral: [owner, tryGetAddressOf('AddressResolver')],
		EtherCollateralpUSD: [owner, tryGetAddressOf('AddressResolver')],
		FeePoolState: [owner, tryGetAddressOf('FeePool')],
		FeePool: [tryGetAddressOf('ProxyFeePool'), owner, tryGetAddressOf('AddressResolver')],
		Pynth: [
			tryGetAddressOf('ProxyERC20Pynth'),
			tryGetAddressOf('TokenStatePynth'),
			tryGetProperty({ property: 'name', otherwise: 'Pynth pUSD' }),
			tryGetProperty({ property: 'symbol', otherwise: 'pUSD' }),
			owner,
			tryGetProperty({ property: 'currencyKey', otherwise: toBytes32('pUSD') }),
			tryGetProperty({ property: 'totalSupply', otherwise: '0' }),
			tryGetAddressOf('AddressResolver'),
		],
		EternalStorage: [owner, tryGetAddressOf(forContract)],
		FeePoolEternalStorage: [owner, tryGetAddressOf('FeePool')],
		DelegateApprovals: [owner, tryGetAddressOf('EternalStorageDelegateApprovals')],
		Liquidations: [owner, tryGetAddressOf('AddressResolver')],
		BinaryOptionMarketFactory: [owner, tryGetAddressOf('AddressResolver')],
		BinaryOptionMarketManager: [
			owner,
			tryGetAddressOf('AddressResolver'),
			61 * 60, // max oracle price age: 61 minutes
			26 * 7 * 24 * 60 * 60, // expiry duration: 26 weeks (~ 6 months)
			365 * 24 * 60 * 60, // Max time to maturity: ~ 1 year
			toWei('2'), // Capital requirement
			toWei('0.05'), // Skew Limit
			toWei('0.008'), // pool fee
			toWei('0.002'), // creator fee
			toWei('0.02'), // refund fee
		],
		BinaryOptionMarketData: [],
		CollateralManagerState: [owner, tryGetAddressOf('CollateralManager')],
		CollateralManager: [
			tryGetAddressOf('CollateralManagerState'),
			owner,
			tryGetAddressOf('AddressResolver'),
			toUnit(50000000),
			0,
			0,
			0,
		],
		CollateralUtil: [tryGetAddressOf('AddressResolver')],
		Collateral: [
			owner,
			tryGetAddressOf('CollateralManager'),
			tryGetAddressOf('AddressResolver'),
			toBytes32('pUSD'),
			toUnit(1.3),
			toUnit(100),
		],
		CollateralEth: [
			owner,
			tryGetAddressOf('CollateralManager'),
			tryGetAddressOf('AddressResolver'),
			toBytes32('pETH'),
			toUnit(1.3),
			toUnit(2),
		],
		CollateralShort: [
			owner,
			tryGetAddressOf('CollateralManager'),
			tryGetAddressOf('AddressResolver'),
			toBytes32('pUSD'),
			toUnit(1.2),
			toUnit(100),
		],
		StakingState: [owner, owner],
		ExternalTokenStakeManager: [
			owner,
			tryGetAddressOf('StakingState'),
			tryGetAddressOf('AddressResolver'),
		],
		BlacklistManager: [owner],
		BridgeState: [owner, tryGetAddressOf('PeriFinance')],
		BridgeStatepUSD: [owner, tryGetAddressOf('Pynth')],
		CrossChainState: [owner, tryGetAddressOf('CrossChainManager')],
		CrossChainManager: [
			owner,
			tryGetAddressOf('AddressResolver'),
			tryGetAddressOf('CrossChainState'),
			debtManager,
		],
	};

	let instance;
	try {
		instance = await create({
			constructorArgs: args.length > 0 ? args : defaultArgs[contract],
		});
		// Show contracts creating for debugging purposes

		if (process.env.DEBUG) {
			log(
				'Deployed',
				contract + (source ? ` (${source})` : '') + (forContract ? ' for ' + forContract : ''),
				mock ? 'mock of ' + mock : '',
				'to',
				instance.address
			);
		}
	} catch (err) {
		throw Error(
			`Failed to deploy ${contract}. Does it have defaultArgs setup?\n\t└─> Caused by ${err.toString()}`
		);
	}

	const postDeployTasks = {
		async Issuer() {
			await Promise.all(
				[].concat(
					// PeriFinance State is where the issuance data lives so it needs to be connected to Issuer
					tryInvocationIfNotMocked({
						name: 'PeriFinanceState',
						fncName: 'setAssociatedContract',
						args: [instance.address],
					}) || []
				)
			);
		},
		async PeriFinance() {
			// first give all PERI supply to the owner (using the hack that the deployerAccount was setup as the associatedContract via
			// the constructor args)
			await cache['TokenStatePeriFinance'].setBalanceOf(owner, SUPPLY_100M, {
				from: deployerAccount,
			});

			// then configure everything else (including setting the associated contract of TokenState back to the PeriFinance contract)
			await Promise.all(
				[
					(cache['TokenStatePeriFinance'].setAssociatedContract(instance.address, { from: owner }),
					cache['ProxyPeriFinance'].setTarget(instance.address, { from: owner }),
					cache['ProxyERC20PeriFinance'].setTarget(instance.address, { from: owner }),
					instance.setProxy(cache['ProxyERC20PeriFinance'].address, {
						from: owner,
					})),
				]
					.concat(
						// If there's a SupplySchedule and it has the method we need (i.e. isn't a mock)
						tryInvocationIfNotMocked({
							name: 'SupplySchedule',
							fncName: 'setPeriFinanceProxy',
							args: [cache['ProxyERC20PeriFinance'].address],
						}) || []
					)
					.concat(
						// If there's an escrow that's not a mock
						tryInvocationIfNotMocked({
							name: 'PeriFinanceEscrow',
							fncName: 'setPeriFinance',
							args: [instance.address],
						}) || []
					)
					.concat(
						// If there's a reward escrow that's not a mock
						tryInvocationIfNotMocked({
							name: 'RewardEscrow',
							fncName: 'setPeriFinance',
							args: [instance.address],
						}) || []
					)
					.concat(
						// If there's a rewards distribution that's not a mock
						tryInvocationIfNotMocked({
							name: 'RewardsDistribution',
							fncName: 'setAuthority',
							args: [instance.address],
						}) || []
					)
					.concat(
						tryInvocationIfNotMocked({
							name: 'RewardsDistribution',
							fncName: 'setPeriFinanceProxy',
							args: [cache['ProxyERC20PeriFinance'].address], // will fail if no Proxy instantiated for PeriFinance
						}) || []
					)
			);
			// set InflationMinter
			instance.setInflationMinter(minterRole, { from: owner });
		},
		async BasePeriFinance() {
			// first give all PERI supply to the owner (using the hack that the deployerAccount was setup as the associatedContract via
			// the constructor args)
			await cache['TokenStateBasePeriFinance'].setBalanceOf(owner, SUPPLY_100M, {
				from: deployerAccount,
			});

			// then configure everything else (including setting the associated contract of TokenState back to the PeriFinance contract)
			await Promise.all(
				[
					(cache['TokenStateBasePeriFinance'].setAssociatedContract(instance.address, {
						from: owner,
					}),
					cache['ProxyBasePeriFinance'].setTarget(instance.address, { from: owner }),
					cache['ProxyERC20BasePeriFinance'].setTarget(instance.address, { from: owner }),
					instance.setProxy(cache['ProxyERC20BasePeriFinance'].address, {
						from: owner,
					})),
				]
					.concat(
						// If there's a rewards distribution that's not a mock
						tryInvocationIfNotMocked({
							name: 'RewardsDistribution',
							fncName: 'setAuthority',
							args: [instance.address],
						}) || []
					)
					.concat(
						tryInvocationIfNotMocked({
							name: 'RewardsDistribution',
							fncName: 'setPeriFinanceProxy',
							args: [cache['ProxyERC20BasePeriFinance'].address], // will fail if no Proxy instantiated for BasePeriFinance
						}) || []
					)
			);
		},
		async MintablePeriFinance() {
			// first give all PERI supply to the owner (using the hack that the deployerAccount was setup as the associatedContract via
			// the constructor args)
			await cache['TokenStateMintablePeriFinance'].setBalanceOf(owner, SUPPLY_100M, {
				from: deployerAccount,
			});

			// then configure everything else (including setting the associated contract of TokenState back to the PeriFinance contract)
			await Promise.all(
				[
					(cache['TokenStateMintablePeriFinance'].setAssociatedContract(instance.address, {
						from: owner,
					}),
					cache['ProxyMintablePeriFinance'].setTarget(instance.address, { from: owner }),
					cache['ProxyERC20MintablePeriFinance'].setTarget(instance.address, { from: owner }),
					instance.setProxy(cache['ProxyERC20MintablePeriFinance'].address, {
						from: owner,
					})),
				]
					.concat(
						// If there's a rewards distribution that's not a mock
						tryInvocationIfNotMocked({
							name: 'RewardsDistribution',
							fncName: 'setAuthority',
							args: [instance.address],
						}) || []
					)
					.concat(
						tryInvocationIfNotMocked({
							name: 'RewardsDistribution',
							fncName: 'setPeriFinanceProxy',
							args: [cache['ProxyERC20MintablePeriFinance'].address], // will fail if no Proxy instantiated for MintablePeriFinance
						}) || []
					)
			);
		},
		async Pynth() {
			await Promise.all(
				[
					cache['TokenStatePynth'].setAssociatedContract(instance.address, { from: owner }),
					cache['ProxyERC20Pynth'].setTarget(instance.address, { from: owner }),
				] || []
			);
		},
		async FeePool() {
			await Promise.all(
				[]
					.concat(
						tryInvocationIfNotMocked({
							name: 'ProxyFeePool',
							fncName: 'setTarget',
							args: [instance.address],
						}) || []
					)
					.concat(
						tryInvocationIfNotMocked({
							name: 'FeePoolState',
							fncName: 'setFeePool',
							args: [instance.address],
						}) || []
					)
					.concat(
						tryInvocationIfNotMocked({
							name: 'FeePoolEternalStorage',
							fncName: 'setAssociatedContract',
							args: [instance.address],
						}) || []
					)
					.concat(
						tryInvocationIfNotMocked({
							name: 'RewardEscrow',
							fncName: 'setFeePool',
							args: [instance.address],
						}) || []
					)
			);
		},
		async DelegateApprovals() {
			await cache['EternalStorageDelegateApprovals'].setAssociatedContract(instance.address, {
				from: owner,
			});
		},
		async Liquidations() {
			await cache['EternalStorageLiquidations'].setAssociatedContract(instance.address, {
				from: owner,
			});
		},
		async Exchanger() {
			await Promise.all([
				cache['ExchangeState'].setAssociatedContract(instance.address, { from: owner }),

				cache['SystemStatus'].updateAccessControl(
					toBytes32('Pynth'),
					instance.address,
					true,
					false,
					{ from: owner }
				),
			]);
		},

		async SystemStatus() {
			// ensure the owner has suspend/resume control over everything
			await instance.updateAccessControls(
				['System', 'Issuance', 'Exchange', 'PynthExchange', 'Pynth'].map(toBytes32),
				[owner, owner, owner, owner, owner],
				[true, true, true, true, true],
				[true, true, true, true, true],
				{ from: owner }
			);
		},

		async GenericMock() {
			if (mock === 'RewardEscrow' || mock === 'PeriFinanceEscrow') {
				await mockGenericContractFnc({ instance, mock, fncName: 'balanceOf', returns: ['0'] });
			} else if (mock === 'EtherCollateral' || mock === 'EtherCollateralpUSD') {
				await mockGenericContractFnc({
					instance,
					mock,
					fncName: 'totalIssuedPynths',
					returns: ['0'],
				});
			} else if (mock === 'FeePool') {
				await Promise.all([
					mockGenericContractFnc({
						instance,
						mock,
						fncName: 'FEE_ADDRESS',
						returns: [getUsers({ network: 'mainnet', user: 'fee' }).address],
					}),
				]);
			} else if (mock === 'Exchanger') {
				await Promise.all([
					mockGenericContractFnc({
						instance,
						mock,
						fncName: 'feeRateForExchange',
						returns: [toWei('0.0030')],
					}),
				]);
			} else if (mock === 'ExchangeState') {
				await Promise.all([
					mockGenericContractFnc({
						instance,
						mock,
						fncName: 'getLengthOfEntries',
						returns: ['0'],
					}),
					mockGenericContractFnc({
						instance,
						mock,
						fncName: 'getMaxTimestamp',
						returns: ['0'],
					}),
				]);
			} else if (mock === 'CollateralManager') {
				await Promise.all([
					mockGenericContractFnc({
						instance,
						mock,
						fncName: 'isPynthManaged',
						returns: [false],
					}),
				]);
			}
		},
	};

	// now run any postDeploy tasks (connecting contracts together)
	if (!skipPostDeploy && postDeployTasks[contract]) {
		await postDeployTasks[contract]();
	}

	return instance;
};

const setupAllContracts = async ({
	accounts,
	existing = {},
	mocks = {},
	contracts = [],
	pynths = [],
	stables = [],
	feeds = [],
}) => {
	const [, owner] = accounts;
	// Copy mocks into the return object, this allows us to include them in the
	// AddressResolver
	const returnObj = Object.assign({}, mocks, existing);

	// BASE CONTRACTS

	// Note: those with deps need to be listed AFTER their deps
	const baseContracts = [
		{ contract: 'AddressResolver' },
		{ contract: 'BlacklistManager' },
		{ contract: 'BridgeState', forContract: 'PeriFinance' },
		{ contract: 'BridgeState', forContract: 'Pynth' },
		{ contract: 'SystemStatus' },
		{ contract: 'ExchangeState' },
		{ contract: 'ExternalTokenStakeManager' },
		{ contract: 'FlexibleStorage', deps: ['AddressResolver'] },
		{
			contract: 'SystemSettings',
			deps: ['AddressResolver', 'FlexibleStorage'],
		},
		{
			contract: 'ExchangeRates',
			deps: ['AddressResolver', 'SystemSettings'],
			mocks: ['Exchanger', 'Issuer'],
		},
		{ contract: 'PeriFinanceState' },
		{ contract: 'SupplySchedule' },
		{ contract: 'ProxyERC20', forContract: 'PeriFinance' },
		{ contract: 'ProxyERC20', forContract: 'MintablePeriFinance' },
		{ contract: 'ProxyERC20', forContract: 'BasePeriFinance' },
		{ contract: 'ProxyERC20', forContract: 'Pynth' }, // for generic pynth
		{ contract: 'Proxy', forContract: 'PeriFinance' },
		{ contract: 'Proxy', forContract: 'MintablePeriFinance' },
		{ contract: 'Proxy', forContract: 'BasePeriFinance' },
		{ contract: 'Proxy', forContract: 'FeePool' },
		{ contract: 'TokenState', forContract: 'PeriFinance' },
		{ contract: 'TokenState', forContract: 'MintablePeriFinance' },
		{ contract: 'TokenState', forContract: 'BasePeriFinance' },
		{ contract: 'TokenState', forContract: 'Pynth' }, // for generic pynth
		{ contract: 'RewardEscrow' },
		{
			contract: 'BaseRewardEscrowV2',
			deps: ['AddressResolver'],
			mocks: ['PeriFinance', 'FeePool'],
		},
		{
			contract: 'RewardEscrowV2',
			deps: ['AddressResolver', 'SystemStatus'],
			mocks: ['PeriFinance', 'FeePool', 'RewardEscrow', 'PeriFinanceBridgeToOptimism', 'Issuer'],
		},
		{
			contract: 'ImportableRewardEscrowV2',
			deps: ['AddressResolver'],
			mocks: ['PeriFinance', 'FeePool', 'PeriFinanceBridgeToBase', 'Issuer'],
		},
		{ contract: 'PeriFinanceEscrow' },
		{
			contract: 'FeePoolEternalStorage',
			mocks: ['BridgeStatepUSD'],
			deps: ['StakingState', 'CrossChainManager', 'Liquidations', 'PeriFinanceEscrow'],
		},
		{ contract: 'FeePoolState', mocks: ['FeePool'] },
		{ contract: 'EternalStorage', forContract: 'DelegateApprovals' },
		{ contract: 'DelegateApprovals', deps: ['EternalStorage'] },
		{ contract: 'EternalStorage', forContract: 'Liquidations' },
		{ contract: 'Liquidations', deps: ['EternalStorage', 'FlexibleStorage'] },
		{
			contract: 'RewardsDistribution',
			mocks: ['PeriFinance', 'FeePool', 'RewardEscrow', 'RewardEscrowV2', 'ProxyFeePool'],
		},
		{
			contract: 'Depot',
			mocks: ['BridgeStatepUSD'],
			deps: ['AddressResolver', 'SystemStatus', 'ExchangeRates'],
		},
		{ contract: 'PynthUtil', deps: ['AddressResolver'] },
		{ contract: 'DappMaintenance' },
		{
			contract: 'EtherCollateral',
			mocks: ['Issuer', 'Depot'],
			deps: [
				'AddressResolver',
				'SystemStatus',
				'StakingState',
				'PeriFinanceEscrow',
				'Liquidations',
			],
		},
		{
			contract: 'EtherCollateralpUSD',
			mocks: ['Issuer', 'ExchangeRates', 'FeePool', 'BridgeStatepUSD'],
			deps: ['AddressResolver', 'SystemStatus', 'CrossChainManager'],
		},
		{
			contract: 'DebtCache',
			mocks: ['Issuer', 'Exchanger', 'CollateralManager'],
			deps: ['ExchangeRates', 'SystemStatus'],
		},
		{
			contract: 'Issuer',
			mocks: [
				'EtherCollateral',
				'EtherCollateralpUSD',
				'CollateralManager',
				'PeriFinance',
				'PeriFinanceState',
				'Exchanger',
				'FeePool',
				'DelegateApprovals',
				'FlexibleStorage',
				'ExternalTokenStakeManager',
			],
			deps: [
				'AddressResolver',
				'SystemStatus',
				'FlexibleStorage',
				'DebtCache',
				'ExternalTokenStakeManager',
			],
		},
		{
			contract: 'Exchanger',
			source: 'ExchangerWithVirtualPynth',
			mocks: ['PeriFinance', 'FeePool', 'DelegateApprovals', 'BridgeStatepUSD'],
			deps: [
				'AddressResolver',
				'TradingRewards',
				'SystemStatus',
				'ExchangeRates',
				'ExchangeState',
				'FlexibleStorage',
				'DebtCache',
			],
		},
		{
			contract: 'Pynth',
			mocks: ['Exchanger', 'FeePool'],
			deps: [
				'Issuer',
				'TokenState',
				'ProxyERC20',
				'BridgeState',
				'SystemStatus',
				'AddressResolver',
			],
		}, // a generic pynth
		{
			contract: 'PeriFinance',
			mocks: [
				'Exchanger',
				'SupplySchedule',
				'RewardEscrow',
				'RewardEscrowV2',
				'PeriFinanceEscrow',
				'RewardsDistribution',
				'Liquidations',
			],
			deps: [
				'Issuer',
				'PeriFinanceState',
				'Proxy',
				'ProxyERC20',
				'AddressResolver',
				'TokenState',
				'SystemStatus',
				'ExchangeRates',
				'BlacklistManager',
			],
		},
		{
			contract: 'BasePeriFinance',
			mocks: [
				'Exchanger',
				'RewardEscrow',
				'RewardEscrowV2',
				'PeriFinanceEscrow',
				'RewardsDistribution',
				'Liquidations',
			],
			deps: [
				'Issuer',
				'PeriFinanceState',
				'Proxy',
				'ProxyERC20',
				'AddressResolver',
				'TokenState',
				'SystemStatus',
				'ExchangeRates',
				'BlacklistManager',
			],
		},
		{
			contract: 'MintablePeriFinance',
			mocks: [
				'Exchanger',
				'PeriFinanceEscrow',
				'Liquidations',
				'Issuer',
				'SystemStatus',
				'ExchangeRates',
				'PeriFinanceBridgeToBase',
			],
			deps: [
				'Proxy',
				'ProxyERC20',
				'AddressResolver',
				'TokenState',
				'RewardsDistribution',
				'RewardEscrow',
				'PeriFinanceState',
				'BlacklistManager',
			],
		},
		{
			contract: 'PeriFinanceBridgeToOptimism',
			mocks: ['ext:Messenger', 'ovm:PeriFinanceBridgeToBase'],
			deps: ['AddressResolver', 'Issuer', 'RewardEscrowV2'],
		},
		{
			contract: 'PeriFinanceBridgeToBase',
			mocks: ['ext:Messenger', 'base:PeriFinanceBridgeToOptimism', 'RewardEscrowV2'],
			deps: ['AddressResolver', 'Issuer'],
		},
		{ contract: 'TradingRewards', deps: ['AddressResolver', 'PeriFinance'] },
		{
			contract: 'FeePool',
			mocks: [
				'PeriFinance',
				'Exchanger',
				'Issuer',
				'PeriFinanceState',
				'RewardEscrow',
				'RewardEscrowV2',
				'DelegateApprovals',
				'FeePoolEternalStorage',
				'RewardsDistribution',
				'FlexibleStorage',
				'EtherCollateralpUSD',
				'CollateralManager',
			],
			deps: ['SystemStatus', 'FeePoolState', 'AddressResolver'],
		},
		{
			contract: 'BinaryOptionMarketFactory',
			deps: ['AddressResolver'],
		},
		{
			contract: 'BinaryOptionMarketManager',
			deps: [
				'SystemStatus',
				'AddressResolver',
				'ExchangeRates',
				'FeePool',
				'PeriFinance',
				'BinaryOptionMarketFactory',
			],
		},
		{
			contract: 'BinaryOptionMarketData',
			deps: ['BinaryOptionMarketManager', 'BinaryOptionMarket', 'BinaryOption'],
		},
		{
			contract: 'CollateralManagerState',
			deps: [],
		},
		{
			contract: 'CollateralUtil',
			deps: ['AddressResolver', 'ExchangeRates'],
		},
		{
			contract: 'CollateralManager',
			deps: [
				'AddressResolver',
				'SystemStatus',
				'Issuer',
				'ExchangeRates',
				'DebtCache',
				'CollateralUtil',
				'CollateralManagerState',
				'StakingState',
			],
		},
		{
			contract: 'Collateral',
			deps: ['CollateralManager', 'AddressResolver', 'CollateralUtil'],
		},
		{
			contract: 'CollateralEth',
			deps: ['Collateral', 'CollateralManager', 'AddressResolver', 'CollateralUtil'],
		},
		{
			contract: 'CollateralShort',
			deps: ['Collateral', 'CollateralManager', 'AddressResolver', 'CollateralUtil'],
		},
		{
			contract: 'StakingState',
			deps: ['ExternalTokenStakeManager'],
		},
		{
			contract: 'CrossChainState',
		},
		{
			contract: 'CrossChainManager',
			deps: ['AddressResolver', 'CrossChainState', 'Issuer', 'BridgeStatepUSD', 'DebtCache'],
		},
	];

	// get deduped list of all required base contracts
	const findAllAssociatedContracts = ({ contractList }) => {
		return Array.from(
			new Set(
				baseContracts
					.filter(({ contract }) => contractList.includes(contract))
					.reduce(
						(memo, { contract, deps = [] }) =>
							memo.concat(contract).concat(findAllAssociatedContracts({ contractList: deps })),
						[]
					)
			)
		);
	};

	// contract names the user requested - could be a list of strings or objects with a "contract" property
	const contractNamesRequested = contracts.map(contract => contract.contract || contract);

	// now go through all contracts and compile a list of them and all nested dependencies
	const contractsRequired = findAllAssociatedContracts({ contractList: contractNamesRequested });

	// now sort in dependency order
	const contractsToFetch = baseContracts.filter(
		({ contract, forContract }) =>
			// keep if contract is required
			contractsRequired.indexOf(contract) > -1 &&
			// and either there is no "forContract" or the forContract is itself required
			(!forContract || contractsRequired.indexOf(forContract) > -1) &&
			// and no entry in the existingContracts object
			!(contract in existing)
	);

	// now setup each contract in serial in case we have deps we need to load
	for (const { contract, source, mocks = [], forContract } of contractsToFetch) {
		// mark each mock onto the returnObj as true when it doesn't exist, indicating it needs to be
		// put through the AddressResolver
		// for all mocks required for this contract
		await Promise.all(
			mocks
				// if the target isn't on the returnObj (i.e. already mocked / created) and not in the list of contracts
				.filter(mock => !(mock in returnObj) && contractNamesRequested.indexOf(mock) < 0)
				// then setup the contract
				.map(mock =>
					setupContract({
						accounts,
						mock,
						contract: 'GenericMock',
						cache: Object.assign({}, mocks, returnObj),
					}).then(instance => (returnObj[mock] = instance))
				)
		);

		// the name of the contract - the contract plus it's forContract
		// (e.g. Proxy + FeePool)
		let forContractName = forContract || '';

		// deploy the contract
		// HACK: if MintablePeriFinance is deployed then rename it
		let contractRegistered = contract;
		if (contract === 'MintablePeriFinance' || contract === 'BasePeriFinance') {
			contractRegistered = 'PeriFinance';
		} else if (contract === 'BridgeState' && forContract === 'Pynth') {
			forContractName = 'pUSD';
		}

		returnObj[contractRegistered + forContractName] = await setupContract({
			accounts,
			contract,
			source,
			forContract,
			// the cache is a combination of the mocks and any return objects
			cache: Object.assign({}, mocks, returnObj),
			// pass through any properties that may be given for this contract
			properties:
				(contracts.find(({ contract: foundContract }) => foundContract === contract) || {})
					.properties || {},
		});
	}

	// pynths

	const pynthsToAdd = [];

	// now setup each pynth and its deps
	for (const pynth of pynths) {
		const { token, proxy, tokenState, bridgeState } = await mockToken({
			accounts,
			pynth,
			supply: 0, // add pynths with 0 supply initially
			skipInitialAllocation: true,
			name: `Pynth ${pynth}`,
			symbol: pynth,
		});

		returnObj[`ProxyERC20${pynth}`] = proxy;
		returnObj[`TokenState${pynth}`] = tokenState;
		returnObj[`Pynth${pynth}`] = token;
		returnObj[`BridgeState${pynth}`] = bridgeState;

		// We'll defer adding the tokens into the Issuer as it must
		// be synchronised with the FlexibleStorage address first.
		pynthsToAdd.push(token.address);
	}

	// stable tokens
	for (const stable of stables) {
		const sToken = await artifacts.require('MockToken').new(
			...[stable, stable, stable === 'USDC' ? '6' : '18'].concat({
				from: owner,
			})
		);

		returnObj[`${stable}`] = sToken;
	}

	if (returnObj['StakingState']) {
		returnObj['StakingState'].setAssociatedContract(
			returnObj['ExternalTokenStakeManager'].address,
			{ from: owner }
		);

		// make stable tokens to be allowed to get staked
		for (const stable of stables) {
			const tokenAddress = await returnObj['StakingState'].tokenAddress(toBytes32(stable));
			if (tokenAddress !== ZERO_ADDRESS) continue;

			await returnObj['StakingState'].setTargetToken(
				toBytes32(await returnObj[`${stable}`].symbol()),
				await returnObj[`${stable}`].address,
				await returnObj[`${stable}`].decimals(),
				{ from: owner }
			);
		}
	}

	if (returnObj['ExternalTokenStakeManager']) {
		returnObj['ExternalTokenStakeManager'].setStakingState(returnObj['StakingState'].address, {
			from: owner,
		});
	}

	if (returnObj['CrossChainState'] && returnObj['CrossChainManager']) {
		returnObj['CrossChainState'].setAssociatedContract(returnObj['CrossChainManager'].address, {
			from: owner,
		});

		returnObj['CrossChainManager'].setCrossChainState(returnObj['CrossChainState'].address, {
			from: owner,
		});
	}

	if (returnObj['AddressResolver']) {
		// now invoke AddressResolver to set all addresses
		if (process.env.DEBUG) {
			log(`Importing into AddressResolver:\n\t - ${Object.keys(returnObj).join('\n\t - ')}`);
		}

		await returnObj['AddressResolver'].importAddresses(
			Object.keys(returnObj).map(toBytes32),
			Object.values(returnObj).map(entry =>
				// use 0x1111 address for any mocks that have no actual deployment
				entry === true ? '0x' + '1'.repeat(40) : entry.address
			),
			{
				from: owner,
			}
		);
	}

	// now rebuild caches for all contracts that need it
	await Promise.all(
		Object.entries(returnObj)
			// keep items not in mocks
			.filter(([name]) => !(name in mocks))
			// and only those with the setResolver function
			.filter(([, instance]) => !!instance.rebuildCache)
			.map(([contract, instance]) => {
				return instance.rebuildCache().catch(err => {
					throw err;
				});
			})
	);

	// if deploying a real PeriFinance, then we add the pynths
	if (returnObj['Issuer'] && !mocks['Issuer']) {
		if (returnObj['Pynth']) {
			returnObj['Issuer'].addPynths([returnObj['Pynth'].address], { from: owner });
		}

		if (pynthsToAdd.length > 0) {
			await returnObj['Issuer'].addPynths(pynthsToAdd, { from: owner });
		}
	}

	// now setup defaults for the system (note: this dupes logic from the deploy script)
	if (returnObj['SystemSettings']) {
		await Promise.all([
			returnObj['SystemSettings'].setWaitingPeriodSecs(WAITING_PERIOD_SECS, { from: owner }),
			returnObj['SystemSettings'].setPriceDeviationThresholdFactor(
				PRICE_DEVIATION_THRESHOLD_FACTOR,
				{ from: owner }
			),
			returnObj['SystemSettings'].setIssuanceRatio(ISSUANCE_RATIO, { from: owner }),
			returnObj['SystemSettings'].setExternalTokenQuota(MAX_EXTERNAL_TOKEN_QUOTA, { from: owner }),
			returnObj['SystemSettings'].setCrossDomainMessageGasLimit(0, CROSS_DOMAIN_DEPOSIT_GAS_LIMIT, {
				from: owner,
			}),
			returnObj['SystemSettings'].setCrossDomainMessageGasLimit(1, CROSS_DOMAIN_ESCROW_GAS_LIMIT, {
				from: owner,
			}),
			returnObj['SystemSettings'].setCrossDomainMessageGasLimit(2, CROSS_DOMAIN_REWARD_GAS_LIMIT, {
				from: owner,
			}),
			returnObj['SystemSettings'].setCrossDomainMessageGasLimit(
				3,
				CROSS_DOMAIN_WITHDRAWAL_GAS_LIMIT,
				{
					from: owner,
				}
			),
			returnObj['SystemSettings'].setFeePeriodDuration(FEE_PERIOD_DURATION, { from: owner }),
			returnObj['SystemSettings'].setTargetThreshold(TARGET_THRESHOLD, { from: owner }),
			returnObj['SystemSettings'].setLiquidationDelay(LIQUIDATION_DELAY, { from: owner }),
			returnObj['SystemSettings'].setLiquidationRatio(LIQUIDATION_RATIO, { from: owner }),
			returnObj['SystemSettings'].setLiquidationEscrowDuration(LIQUIDATION_ESCROW_DURATION, {
				from: owner,
			}),
			returnObj['SystemSettings'].setLiquidationPenalty(LIQUIDATION_PENALTY, {
				from: owner,
			}),
			returnObj['SystemSettings'].setPeriLiquidationPenalty(PERI_LIQUIDATION_PENALTY, {
				from: owner,
			}),
			returnObj['SystemSettings'].setSelfLiquidationPenalty(SELF_LIQUIDATION_PENALTY, {
				from: owner,
			}),
			returnObj['SystemSettings'].setFlagReward(FLAG_REWARD, { from: owner }),
			returnObj['SystemSettings'].setLiquidateReward(LIQUIDATE_REWARD, { from: owner }),
			returnObj['SystemSettings'].setRateStalePeriod(RATE_STALE_PERIOD, { from: owner }),
			returnObj['SystemSettings'].setMinimumStakeTime(MINIMUM_STAKE_TIME, { from: owner }),
			returnObj['SystemSettings'].setDebtSnapshotStaleTime(DEBT_SNAPSHOT_STALE_TIME, {
				from: owner,
			}),
		]);
	}

	// finally if any of our contracts have setSystemStatus (from MockPynth), then invoke it
	await Promise.all(
		Object.values(returnObj)
			.filter(contract => contract.setSystemStatus)
			.map(mock => mock.setSystemStatus(returnObj['SystemStatus'].address))
	);

	if (returnObj['ExchangeRates']) {
		// setup SNX price feed and any other feeds
		const keys = ['PERI', ...(feeds || [])].map(toBytes32);
		const prices = ['0.2', ...(feeds || []).map(() => '1.0')].map(toUnit);
		await setupPriceAggregators(returnObj['ExchangeRates'], owner, keys);
		await updateAggregatorRates(
			returnObj['ExchangeRates'],
			returnObj['CircuitBreaker'],
			keys,
			prices
		);
	}

	return returnObj;
};

module.exports = {
	mockToken,
	mockGenericContractFnc,
	setupContract,
	setupAllContracts,
};
