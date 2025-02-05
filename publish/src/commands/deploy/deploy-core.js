'use strict';

const { gray } = require('chalk');

const {
	constants: { ZERO_ADDRESS },
	defaults: { TEMP_OWNER_DEFAULT_DURATION },
} = require('../../../..');



module.exports = async ({
	account,
	addressOf,
	currentLastMintEvent,
	currentPeriFinanceSupply,
	currentWeekOfInflation,
	deployer,
	useOvm,
	childChainManagerAddress,
	validatorAddress,
	chainId,
	debtManagerAddress
}) => {

	

	console.log(gray(`\n------ DEPLOY LIBRARIES ------\n`));

	

	await deployer.deployContract({
		name: 'SafeDecimalMath',
		library: true,
	});

	await deployer.deployContract({
		name: 'Math',
		library: true,
	});

	await deployer.deployContract({
		name: 'SystemSettingsLib',
		library: true,
	});

	await deployer.deployContract({
		name: 'SignedSafeDecimalMath',
		library: true,
	});

	await deployer.deployContract({
		name: 'ExchangeSettlementLib',
		library: true,
	});

	console.log(gray(`\n------ DEPLOY ADDRESS RESOLVER ------\n`));

	await deployer.deployContract({
		name: 'AddressResolver',
		args: [account],
	});

	const readProxyForResolver = await deployer.deployContract({
		name: 'ReadProxyAddressResolver',
		source: 'ReadProxy',
		args: [account],
	});

	console.log(gray(`\n------ DEPLOY SELF ORACLES ------\n`));

	await deployer.deployContract({
		name: 'OneNetAggregatorIssuedPynths',
		args: [addressOf(readProxyForResolver)],
	});

	await deployer.deployContract({
		name: 'OneNetAggregatorDebtRatio',
		args: [addressOf(readProxyForResolver)],
	});

	console.log(gray(`\n------ DEPLOY CORE PROTOCOL ------\n`));

	await deployer.deployContract({
		name: 'FlexibleStorage',
		deps: ['ReadProxyAddressResolver'],
		args: [addressOf(readProxyForResolver)],
	});

	await deployer.deployContract({
		name: 'SystemSettings',
		args: [account, addressOf(readProxyForResolver)],
	});

	await deployer.deployContract({
		name: 'SystemStatus',
		args: [account],
	});

	await deployer.deployContract({
		name: 'ExchangeRates',
		source: useOvm ? 'ExchangeRates' : 'ExchangeRatesWithDexPricing',
		args: [account, addressOf(readProxyForResolver)],
	});

	const tokenStatePeriFinance = await deployer.deployContract({
		name: 'TokenStatePeriFinance',
		source: 'LegacyTokenState',
		args: [account, account],
	});

	const blacklistManager = await deployer.deployContract({
		name: 'BlacklistManager',
		source: 'BlacklistManager',
		args: [account],
	});

	const proxyERC20PeriFinance = await deployer.deployContract({
		name: 'ProxyPeriFinance',
		source: 'ProxyERC20',
		args: [account],
	});

	const crossChainState = await deployer.deployContract({
		name: 'CrossChainState',
		source: 'CrossChainState',
		args: [account, ZERO_ADDRESS, chainId],
	});

	const crossChainManager = await deployer.deployContract({
		name: 'CrossChainManager',
		source: 'CrossChainManager',
		// deps: ['Issuer', 'CrossChainState', 'AddressResolver'],
		deps: ['CrossChainState', 'AddressResolver'],
		args: [
			account,
			addressOf(readProxyForResolver),
			addressOf(crossChainState),
			debtManagerAddress,
		],
	});

	const periFinance = await deployer.deployContract({
		name: 'PeriFinance',
		source: useOvm ? 'MintablePeriFinance' : 'PeriFinance',
		deps: ['ProxyPeriFinance', 'TokenStatePeriFinance', 'AddressResolver', 'BlacklistManager'],
		args: [
			addressOf(proxyERC20PeriFinance),
			addressOf(tokenStatePeriFinance),
			account,
			currentPeriFinanceSupply,
			addressOf(readProxyForResolver),
			childChainManagerAddress, // address of childChainManager,
			addressOf(blacklistManager),
			validatorAddress,
		],
	});

	const periBridgeState = await deployer.deployContract({
		name: 'BridgeState',
		source: 'BridgeState',
		deps: ['PeriFinance'],
		args: [account, addressOf(periFinance)],
	});

	const periBridgeStatepUSD = await deployer.deployContract({
		name: 'BridgeStatepUSD',
		source: 'BridgeState',
		deps: ['PeriFinance'],
		args: [account, addressOf(periFinance)],
	});

	const liquidations = await deployer.deployContract({
		name: 'Liquidations',
		args: [account, addressOf(readProxyForResolver)],
	});

	const eternalStorageLiquidations = await deployer.deployContract({
		name: 'EternalStorageLiquidations',
		source: 'EternalStorage',
		args: [account, addressOf(liquidations)],
	});

	const stakingState = await deployer.deployContract({
		name: `StakingState`,
		source: 'StakingState',
		args: [account, ZERO_ADDRESS],
	});


	const externalTokenStakeManager = await deployer.deployContract({
		name: `ExternalTokenStakeManager`,
		source: 'ExternalTokenStakeManager',
		deps: ['AddressResolver', 'StakingState'],
		args: [account, addressOf(stakingState), addressOf(readProxyForResolver)],
	});

	await deployer.deployContract({
		name: 'RewardEscrow',
		args: [account, ZERO_ADDRESS, ZERO_ADDRESS],
	});

	// SIP-252: frozen V2 escrow for migration to new escrow
	// this is actually deployed in integration tests, but it shouldn't be deployed (should only be configured)
	// for fork-tests & actual deployment (by not specifying RewardEscrowV2Frozen in config and releases)
	// await deployer.deployContract({
	// 	name: 'RewardEscrowV2Frozen',
	// 	source: useOvm ? 'ImportableRewardEscrowV2Frozen' : 'RewardEscrowV2Frozen',
	// 	args: [account, addressOf(readProxyForResolver)],
	// 	deps: ['AddressResolver'],
	// });

	// SIP-252: storage contract for RewardEscrowV2
	await deployer.deployContract({
		name: 'RewardEscrowV2Storage',
		args: [account, ZERO_ADDRESS],
		deps: ['AddressResolver'],
	});

	const rewardEscrowV2 = await deployer.deployContract({
		name: 'RewardEscrowV2',
		source: useOvm ? 'ImportableRewardEscrowV2' : 'RewardEscrowV2',
		args: [account, addressOf(readProxyForResolver)],
		deps: ['AddressResolver'],
	});

	const periFinanceEscrow = await deployer.deployContract({
		name: 'PeriFinanceEscrow',
		args: [account, ZERO_ADDRESS, account],
	});

	await deployer.deployContract({
		name: 'PeriFinanceDebtShare',
		deps: ['AddressResolver'],
		args: [account, addressOf(readProxyForResolver)],
	});

	const proxyFeePool = await deployer.deployContract({
		name: 'ProxyFeePool',
		source: 'Proxy',
		args: [account],
	});

	const delegateApprovalsEternalStorage = await deployer.deployContract({
		name: 'DelegateApprovalsEternalStorage',
		source: 'EternalStorage',
		args: [account, ZERO_ADDRESS],
	});

	await deployer.deployContract({
		name: 'DelegateApprovals',
		args: [account, addressOf(delegateApprovalsEternalStorage)],
	});

	await deployer.deployContract({
		name: 'FeePoolEternalStorage',
		args: [account, ZERO_ADDRESS],
	});

	const feePool = await deployer.deployContract({
		name: 'FeePool',
		deps: ['ProxyFeePool', 'AddressResolver'],
		args: [addressOf(proxyFeePool), account, addressOf(readProxyForResolver)],
	});

	await deployer.deployContract({
		name: 'FeePoolState',
		deps: ['FeePool'],
		args: [account, addressOf(feePool)],
	});

	await deployer.deployContract({
		name: 'RewardsDistribution',
		deps: useOvm ? ['RewardEscrowV2', 'ProxyFeePool'] : ['RewardEscrowV2', 'ProxyFeePool'],
		args: [
			account, // owner
			ZERO_ADDRESS, // authority (periFinance)
			ZERO_ADDRESS, // PeriFinance Proxy
			addressOf(rewardEscrowV2),
			addressOf(proxyFeePool),
		],
	});

	await deployer.deployContract({
		name: 'DebtCache',
		deps: ['AddressResolver'],
		args: [account, addressOf(readProxyForResolver)],
	});

	const exchanger = await deployer.deployContract({
		name: 'Exchanger',
		source: 'Exchanger',
		deps: ['AddressResolver'],
		args: [account, addressOf(readProxyForResolver)],
	});

	await deployer.deployContract({
		name: 'CircuitBreaker',
		source: 'CircuitBreaker',
		deps: ['AddressResolver'],
		args: [account, addressOf(readProxyForResolver)],
	});

	await deployer.deployContract({
		name: 'ExchangeCircuitBreaker',
		source: 'ExchangeCircuitBreaker',
		deps: ['AddressResolver'],
		args: [account, addressOf(readProxyForResolver)],
	});


	await deployer.deployContract({
		name: 'ExchangeState',
		deps: ['Exchanger'],
		args: [account, addressOf(exchanger)],
	});

	await deployer.deployContract({
		name: 'Issuer',
		deps: ['AddressResolver'],
		args: [account, addressOf(readProxyForResolver)],
	});

	await deployer.deployContract({
		name: 'TradingRewards',
		deps: ['AddressResolver', 'Exchanger'],
		args: [account, account, addressOf(readProxyForResolver)],
	});

	await deployer.deployContract({
		name: 'SupplySchedule',
		args: [account, currentLastMintEvent, currentWeekOfInflation],
	});

	if (periFinanceEscrow) {
		await deployer.deployContract({
			name: 'EscrowChecker',
			deps: ['PeriFinanceEscrow'],
			args: [addressOf(periFinanceEscrow)],
		});
	}

	await deployer.deployContract({
		name: 'PeriFinanceBridgeToBase',
		deps: ['AddressResolver'],
		args: [account, addressOf(readProxyForResolver)],
	});

	await deployer.deployContract({
		name: 'PeriFinanceBridgeToOptimism',
		deps: ['AddressResolver'],
		args: [account, addressOf(readProxyForResolver)],
	});

	await deployer.deployContract({
		name: 'DirectIntegrationManager',
		source: 'DirectIntegrationManager',
		deps: ['AddressResolver'],
		args: [account, addressOf(readProxyForResolver)],
	});
	
};
