pragma solidity 0.5.16;
pragma experimental ABIEncoderV2;

// Inheritance
import "./BaseRewardEscrowV2.sol";

// https://docs.peri.finance/contracts/RewardEscrow
contract ImportableRewardEscrowV2 is BaseRewardEscrowV2 {
    /* ========== ADDRESS RESOLVER CONFIGURATION ========== */
    bytes32 private constant CONTRACT_PERIFINANCE_BRIDGE_BASE = "PeriFinanceBridgeToBase";

    /* ========== CONSTRUCTOR ========== */

    constructor(address _owner, address _resolver) public BaseRewardEscrowV2(_owner, _resolver) {}

    /* ========== VIEWS ======================= */

    function resolverAddressesRequired() public view returns (bytes32[] memory addresses) {
        bytes32[] memory existingAddresses = BaseRewardEscrowV2.resolverAddressesRequired();
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
        // add escrowedAmount to account and total aggregates
        state().updateEscrowAccountBalance(account, SafeCast.toInt256(escrowedAmount));

        // There must be enough balance in the contract to provide for the escrowed balance.
        require(
            totalEscrowedBalance() <= IERC20(address(periFinance())).balanceOf(address(this)),
            "Insufficient balance in the contract to provide for escrowed balance"
        );

        for (uint i = 0; i < vestingEntries.length; i++) {
            state().addVestingEntry(account, vestingEntries[i]);
        }
    }

    modifier onlyPeriFinanceBridge() {
        require(msg.sender == periFinanceBridgeToBase(), "Can only be invoked by PeriFinanceBridgeToBase contract");
        _;
    }
}
