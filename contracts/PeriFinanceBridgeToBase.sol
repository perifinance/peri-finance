pragma solidity 0.5.16;
pragma experimental ABIEncoderV2;

// Inheritance
import "./Owned.sol";
import "./MixinResolver.sol";
import "./MixinSystemSettings.sol";
import "./interfaces/IPeriFinanceBridgeToBase.sol";

// Internal references
import "./interfaces/IPeriFinance.sol";
import "./interfaces/IRewardEscrowV2.sol";
import "./interfaces/IPeriFinanceBridgeToOptimism.sol";

// solhint-disable indent
import "@eth-optimism/contracts/build/contracts/iOVM/bridge/iOVM_BaseCrossDomainMessenger.sol";

contract PeriFinanceBridgeToBase is Owned, MixinSystemSettings, IPeriFinanceBridgeToBase {
    /* ========== ADDRESS RESOLVER CONFIGURATION ========== */
    bytes32 private constant CONTRACT_EXT_MESSENGER = "ext:Messenger";
    bytes32 private constant CONTRACT_PERIFINANCE = "PeriFinance";
    bytes32 private constant CONTRACT_REWARDESCROW = "RewardEscrowV2";
    bytes32 private constant CONTRACT_BASE_PERIFINANCEBRIDGETOOPTIMISM = "base:PeriFinanceBridgeToOptimism";

    // ========== CONSTRUCTOR ==========

    constructor(address _owner, address _resolver) public Owned(_owner) MixinSystemSettings(_resolver) {}

    //
    // ========== INTERNALS ============

    function messenger() internal view returns (iOVM_BaseCrossDomainMessenger) {
        return iOVM_BaseCrossDomainMessenger(requireAndGetAddress(CONTRACT_EXT_MESSENGER));
    }

    function periFinance() internal view returns (IPeriFinance) {
        return IPeriFinance(requireAndGetAddress(CONTRACT_PERIFINANCE));
    }

    function rewardEscrowV2() internal view returns (IRewardEscrowV2) {
        return IRewardEscrowV2(requireAndGetAddress(CONTRACT_REWARDESCROW));
    }

    function periFinanceBridgeToOptimism() internal view returns (address) {
        return requireAndGetAddress(CONTRACT_BASE_PERIFINANCEBRIDGETOOPTIMISM);
    }

    function onlyAllowFromOptimism() internal view {
        // ensure function only callable from the L2 bridge via messenger (aka relayer)
        iOVM_BaseCrossDomainMessenger _messenger = messenger();
        require(msg.sender == address(_messenger), "Only the relayer can call this");
        require(_messenger.xDomainMessageSender() == periFinanceBridgeToOptimism(), "Only the L1 bridge can invoke");
    }

    modifier onlyOptimismBridge() {
        onlyAllowFromOptimism();
        _;
    }

    // ========== VIEWS ==========

    function resolverAddressesRequired() public view returns (bytes32[] memory addresses) {
        bytes32[] memory existingAddresses = MixinSystemSettings.resolverAddressesRequired();
        bytes32[] memory newAddresses = new bytes32[](4);
        newAddresses[0] = CONTRACT_EXT_MESSENGER;
        newAddresses[1] = CONTRACT_PERIFINANCE;
        newAddresses[2] = CONTRACT_BASE_PERIFINANCEBRIDGETOOPTIMISM;
        newAddresses[3] = CONTRACT_REWARDESCROW;
        addresses = combineArrays(existingAddresses, newAddresses);
    }

    // ========== PUBLIC FUNCTIONS =========

    // invoked by user on L2
    function initiateWithdrawal(uint amount) external {
        require(periFinance().transferablePeriFinance(msg.sender) >= amount, "Not enough transferable PERI");

        // instruct L2 PeriFinance to burn this supply
        periFinance().burnSecondary(msg.sender, amount);

        // create message payload for L1
        IPeriFinanceBridgeToOptimism bridgeToOptimism;
        bytes memory messageData = abi.encodeWithSelector(bridgeToOptimism.completeWithdrawal.selector, msg.sender, amount);

        // relay the message to Bridge on L1 via L2 Messenger
        messenger().sendMessage(
            periFinanceBridgeToOptimism(),
            messageData,
            uint32(getCrossDomainMessageGasLimit(CrossDomainMessageGasLimits.Withdrawal))
        );

        emit WithdrawalInitiated(msg.sender, amount);
    }

    // ========= RESTRICTED FUNCTIONS ==============

    function completeEscrowMigration(
        address account,
        uint256 escrowedAmount,
        VestingEntries.VestingEntry[] calldata vestingEntries
    ) external onlyOptimismBridge {
        IRewardEscrowV2 rewardEscrow = rewardEscrowV2();
        // First, mint the escrowed PERI that are being migrated
        periFinance().mintSecondary(address(rewardEscrow), escrowedAmount);
        rewardEscrow.importVestingEntries(account, escrowedAmount, vestingEntries);
        emit ImportedVestingEntries(account, escrowedAmount, vestingEntries);
    }

    // invoked by Messenger on L2
    function completeDeposit(address account, uint256 depositAmount) external onlyOptimismBridge {
        // now tell PeriFinance to mint these tokens, deposited in L1, into the same account for L2
        periFinance().mintSecondary(account, depositAmount);
        emit MintedSecondary(account, depositAmount);
    }

    // invoked by Messenger on L2
    function completeRewardDeposit(uint256 amount) external onlyOptimismBridge {
        // now tell PeriFinance to mint these tokens, deposited in L1, into reward escrow on L2
        periFinance().mintSecondaryRewards(amount);
        emit MintedSecondaryRewards(amount);
    }

    // ========== EVENTS ==========
    event ImportedVestingEntries(
        address indexed account,
        uint256 escrowedAmount,
        VestingEntries.VestingEntry[] vestingEntries
    );
    event MintedSecondary(address indexed account, uint256 amount);
    event MintedSecondaryRewards(uint256 amount);
    event WithdrawalInitiated(address indexed account, uint256 amount);
}
