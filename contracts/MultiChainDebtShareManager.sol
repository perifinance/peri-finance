pragma solidity 0.5.16;

// Inheritance
import "./Owned.sol";
import "./MixinResolver.sol";
import "./MixinSystemSettings.sol";

import "./interfaces/IMultiChainDebtShareManager.sol";
import "./interfaces/IMultiChainDebtShareState.sol";

// Libraries
import "./SafeDecimalMath.sol";

contract MultiChainDebtShareManager is Owned, MixinResolver, MixinSystemSettings, IMultiChainDebtShareManager {
    using SafeDecimalMath for uint;

    IMultiChainDebtShareState public multiChainDebtShareState;

    constructor(
        address owner,
        address debtShareState,
        address resolver
    ) public Owned(owner) MixinSystemSettings(resolver) {
        multiChainDebtShareState = IMultiChainDebtShareState(debtShareState);
    }

    // View functions
    function getCurrentExternalDebtEntry() external view returns (uint debtShare) {
        (debtShare, ) = multiChainDebtShareState.lastDebtShareStorageInfo();
    }

    // Mutative functions
    function setCurrentExternalDebtEntry(uint debtShare) external onlyOwner {
        multiChainDebtShareState.appendToDebtShareStorage(debtShare);
    }

    function removeCurrentExternalDebtEntry() external onlyOwner {
        uint lastIndex = multiChainDebtShareState.debtShareStorageLength() - 1;
        multiChainDebtShareState.removeDebtShareStorage(lastIndex);
    }

    function setMultiChainDebtShareState(address _multiChainDebtShareState) external onlyOwner {
        multiChainDebtShareState = IMultiChainDebtShareState(_multiChainDebtShareState);
    }
}
