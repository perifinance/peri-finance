'use strict';

const { gray } = require('chalk');
const { toBytes32 } = require('../../../..');

module.exports = async ({
	account,
	addressOf,
	config,
	deployer,
	getDeployParameter,
	network,
	runStep,
	useOvm,
}) => {
	console.log(gray(`\n------ CONFIGURE LEGACY CONTRACTS VIA SETTERS ------\n`));

	const {
		DelegateApprovals,
		DelegateApprovalsEternalStorage,
		Exchanger,
		ExchangeState,
		ExchangeCircuitBreaker,
		FeePool,
		FeePoolEternalStorage,
		Issuer,
		ProxyFeePool,
		ProxyPeriFinance,
		RewardEscrow,
		RewardsDistribution,
		SupplySchedule,
		PeriFinance,
		PeriFinanceEscrow,
		SystemStatus,
		TokenStatePeriFinance,
	} = deployer.deployedContracts;

	// now configure everything
	if (network !== 'mainnet' && SystemStatus) {
		// On testnet, give the owner of SystemStatus the rights to update status
		const statusOwner = await SystemStatus.methods.owner().call();
		await runStep({
			contract: 'SystemStatus',
			target: SystemStatus,
			read: 'accessControl',
			readArg: [toBytes32('System'), statusOwner],
			expected: ({ canSuspend } = {}) => canSuspend,
			write: 'updateAccessControls',
			writeArg: [
				['System', 'Issuance', 'Exchange', 'PynthExchange', 'Pynth', 'Futures'].map(toBytes32),
				[statusOwner, statusOwner, statusOwner, statusOwner, statusOwner, statusOwner],
				[true, true, true, true, true, true],
				[true, true, true, true, true, true],
			],
			comment: 'Ensure the owner can suspend and resume the protocol',
		});
	}
	if (DelegateApprovals && DelegateApprovalsEternalStorage) {
		await runStep({
			contract: 'DelegateApprovalsEternalStorage',
			target: DelegateApprovalsEternalStorage,
			read: 'associatedContract',
			expected: input => input === addressOf(DelegateApprovals),
			write: 'setAssociatedContract',
			writeArg: addressOf(DelegateApprovals),
			comment: 'Ensure that DelegateApprovals contract is allowed to write to its EternalStorage',
		});
	}

	if (ProxyFeePool && FeePool) {
		await runStep({
			contract: 'ProxyFeePool',
			target: ProxyFeePool,
			read: 'target',
			expected: input => input === addressOf(FeePool),
			write: 'setTarget',
			writeArg: addressOf(FeePool),
			comment: 'Ensure the ProxyFeePool contract has the correct FeePool target set',
		});
	}

	if (FeePoolEternalStorage && FeePool) {
		await runStep({
			contract: 'FeePoolEternalStorage',
			target: FeePoolEternalStorage,
			read: 'associatedContract',
			expected: input => input === addressOf(FeePool),
			write: 'setAssociatedContract',
			writeArg: addressOf(FeePool),
			comment: 'Ensure the FeePool contract can write to its EternalStorage',
		});
	}

	if (ProxyPeriFinance && PeriFinance) {
		await runStep({
			contract: 'ProxyPeriFinance',
			target: ProxyPeriFinance,
			read: 'target',
			expected: input => input === addressOf(PeriFinance),
			write: 'setTarget',
			writeArg: addressOf(PeriFinance),
			comment: 'Ensure the SNX proxy has the correct PeriFinance target set',
		});
		await runStep({
			contract: 'PeriFinance',
			target: PeriFinance,
			read: 'proxy',
			expected: input => input === addressOf(ProxyPeriFinance),
			write: 'setProxy',
			writeArg: addressOf(ProxyPeriFinance),
			comment: 'Ensure the PeriFinance contract has the correct ERC20 proxy set',
		});
	}

	if (Exchanger && ExchangeState) {
		// The ExchangeState contract has Exchanger as it's associated contract
		await runStep({
			contract: 'ExchangeState',
			target: ExchangeState,
			read: 'associatedContract',
			expected: input => input === Exchanger.options.address,
			write: 'setAssociatedContract',
			writeArg: Exchanger.options.address,
			comment: 'Ensure the Exchanger contract can write to its State',
		});
	}

	if (ExchangeCircuitBreaker && SystemStatus) {
		// SIP-65: ensure Exchanger can suspend pynths if price spikes occur
		await runStep({
			contract: 'SystemStatus',
			target: SystemStatus,
			read: 'accessControl',
			readArg: [toBytes32('Pynth'), addressOf(ExchangeCircuitBreaker)],
			expected: ({ canSuspend } = {}) => canSuspend,
			write: 'updateAccessControl',
			writeArg: [toBytes32('Pynth'), addressOf(ExchangeCircuitBreaker), true, false],
			comment: 'Ensure the ExchangeCircuitBreaker contract can suspend pynths - see SIP-65',
		});
	}

	if (Issuer && SystemStatus) {
		// SIP-165: ensure Issuer can suspend issuance if unusual volitility occurs
		await runStep({
			contract: 'SystemStatus',
			target: SystemStatus,
			read: 'accessControl',
			readArg: [toBytes32('Issuance'), addressOf(Issuer)],
			expected: ({ canSuspend } = {}) => canSuspend,
			write: 'updateAccessControl',
			writeArg: [toBytes32('Issuance'), addressOf(Issuer), true, false],
			comment: 'Ensure Issuer contract can suspend issuance - see SIP-165',
		});
	}

	// only reset token state if redeploying
	if (TokenStatePeriFinance && config['TokenStatePeriFinance'].deploy) {
		const initialIssuance = await getDeployParameter('INITIAL_ISSUANCE');
		await runStep({
			contract: 'TokenStatePeriFinance',
			target: TokenStatePeriFinance,
			read: 'balanceOf',
			readArg: account,
			expected: input => input === initialIssuance,
			write: 'setBalanceOf',
			writeArg: [account, initialIssuance],
			comment:
				'Ensure the TokenStatePeriFinance contract has the correct initial issuance (WARNING: only for new deploys)',
		});
	}

	if (TokenStatePeriFinance && PeriFinance) {
		await runStep({
			contract: 'TokenStatePeriFinance',
			target: TokenStatePeriFinance,
			read: 'associatedContract',
			expected: input => input === addressOf(PeriFinance),
			write: 'setAssociatedContract',
			writeArg: addressOf(PeriFinance),
			comment: 'Ensure the PeriFinance contract can write to its TokenState contract',
		});
	}

	if (RewardEscrow && PeriFinance) {
		await runStep({
			contract: 'RewardEscrow',
			target: RewardEscrow,
			read: 'periFinance',
			expected: input => input === addressOf(PeriFinance),
			write: 'setPeriFinance',
			writeArg: addressOf(PeriFinance),
			comment: 'Ensure the legacy RewardEscrow contract is connected to the PeriFinance contract',
		});
	}

	if (RewardEscrow && FeePool) {
		await runStep({
			contract: 'RewardEscrow',
			target: RewardEscrow,
			read: 'feePool',
			expected: input => input === addressOf(FeePool),
			write: 'setFeePool',
			writeArg: addressOf(FeePool),
			comment: 'Ensure the legacy RewardEscrow contract is connected to the FeePool contract',
		});
	}

	if (SupplySchedule && PeriFinance) {
		await runStep({
			contract: 'SupplySchedule',
			target: SupplySchedule,
			read: 'periFinanceProxy',
			expected: input => input === addressOf(ProxyPeriFinance),
			write: 'setPeriFinanceProxy',
			writeArg: addressOf(ProxyPeriFinance),
			comment: 'Ensure the SupplySchedule is connected to the SNX proxy for reading',
		});
	}

	if (PeriFinance && RewardsDistribution) {
		await runStep({
			contract: 'RewardsDistribution',
			target: RewardsDistribution,
			read: 'authority',
			expected: input => input === addressOf(PeriFinance),
			write: 'setAuthority',
			writeArg: addressOf(PeriFinance),
			comment: 'Ensure the RewardsDistribution has PeriFinance set as its authority for distribution',
		});

		await runStep({
			contract: 'RewardsDistribution',
			target: RewardsDistribution,
			read: 'periFinanceProxy',
			expected: input => input === addressOf(ProxyPeriFinance),
			write: 'setPeriFinanceProxy',
			writeArg: addressOf(ProxyPeriFinance),
			comment: 'Ensure the RewardsDistribution can find the PeriFinance proxy to read and transfer',
		});
	}

	// ----------------
	// Setting ProxyPeriFinance PeriFinance for PeriFinanceEscrow
	// ----------------

	// Skip setting unless redeploying either of these,
	if (config['PeriFinance'].deploy || config['PeriFinanceEscrow'].deploy) {
		// Note: currently on mainnet PeriFinanceEscrow.PeriFinance() does NOT exist
		// it is "havven" and the ABI we have here is not sufficient
		if (network === 'mainnet' && !useOvm) {
			await runStep({
				contract: 'PeriFinanceEscrow',
				target: PeriFinanceEscrow,
				read: 'havven',
				expected: input => input === addressOf(ProxyPeriFinance),
				write: 'setHavven',
				writeArg: addressOf(ProxyPeriFinance),
				comment:
					'Ensure the legacy token sale escrow can find the PeriFinance proxy to read and transfer',
			});
		} else {
			await runStep({
				contract: 'PeriFinanceEscrow',
				target: PeriFinanceEscrow,
				read: 'periFinance',
				expected: input => input === addressOf(ProxyPeriFinance),
				write: 'setPeriFinance',
				writeArg: addressOf(ProxyPeriFinance),
				comment: 'Ensure the token sale escrow can find the PeriFinance proxy to read and transfer',
			});
		}
	}
};
