pragma solidity ^0.5.16;
pragma experimental ABIEncoderV2;

// Inheritance
import "./BaseRewardEscrowV2Frozen.sol";

// https://docs.periFinance.io/contracts/RewardEscrow
/// SIP-252: this is the source for immutable V2 escrow on L2 (renamed with suffix Frozen).
/// These sources need to exist here and match on-chain frozen contracts for tests and reference.
/// The reason for the naming mess is that the immutable LiquidatorRewards expects a working
/// RewardEscrowV2 resolver entry for its getReward method, so the "new" (would be V3)
/// needs to be found at that entry for liq-rewards to function.
contract ImportableRewardEscrowV2Frozen is BaseRewardEscrowV2Frozen {
    /* ========== ADDRESS RESOLVER CONFIGURATION ========== */
    bytes32 private constant CONTRACT_PERIFINANCE_BRIDGE_BASE = "PeriFinanceBridgeToBase";

    /* ========== CONSTRUCTOR ========== */

    constructor(address _owner, address _resolver) public BaseRewardEscrowV2Frozen(_owner, _resolver) {}

    /* ========== VIEWS ======================= */

    function resolverAddressesRequired() public view returns (bytes32[] memory addresses) {
        bytes32[] memory existingAddresses = BaseRewardEscrowV2Frozen.resolverAddressesRequired();
        bytes32[] memory newAddresses = new bytes32[](1);
        newAddresses[0] = CONTRACT_PERIFINANCE_BRIDGE_BASE;
        return combineArrays(existingAddresses, newAddresses);
    }

    function periFinanceBridgeToBase() internal view returns (address) {
        return requireAndGetAddress(CONTRACT_PERIFINANCE_BRIDGE_BASE);
    }

    /* ========== MUTATIVE FUNCTIONS ========== */

    function importVestingEntries(
        address account,
        uint256 escrowedAmount,
        VestingEntries.VestingEntry[] calldata vestingEntries
    ) external onlyPeriFinanceBridge {
        // There must be enough balance in the contract to provide for the escrowed balance.
        totalEscrowedBalance = totalEscrowedBalance.add(escrowedAmount);
        require(
            totalEscrowedBalance <= IERC20(address(periFinance())).balanceOf(address(this)),
            "Insufficient balance in the contract to provide for escrowed balance"
        );

        /* Add escrowedAmount to account's escrowed balance */
        totalEscrowedAccountBalance[account] = totalEscrowedAccountBalance[account].add(escrowedAmount);

        for (uint i = 0; i < vestingEntries.length; i++) {
            _importVestingEntry(account, vestingEntries[i]);
        }
    }

    function _importVestingEntry(address account, VestingEntries.VestingEntry memory entry) internal {
        uint entryID = nextEntryId;
        vestingSchedules[account][entryID] = entry;

        /* append entryID to list of entries for account */
        accountVestingEntryIDs[account].push(entryID);

        /* Increment the next entry id. */
        nextEntryId = nextEntryId.add(1);
    }

    modifier onlyPeriFinanceBridge() {
        require(msg.sender == periFinanceBridgeToBase(), "Can only be invoked by PeriFinanceBridgeToBase contract");
        _;
    }
}
