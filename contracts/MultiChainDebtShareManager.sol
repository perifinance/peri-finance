pragma solidity 0.5.16;

// Inheritance
import "./Owned.sol";

import "./interfaces/IMultiChainDebtShareManager.sol";
import "./interfaces/IMultiChainDebtShareState.sol";

contract MultiChainDebtShareManager is Owned, IMultiChainDebtShareManager {
    IMultiChainDebtShareState internal _multiChainDebtShareState;

    constructor(address _owner, address _debtShareState) public Owned(_owner) {
        _multiChainDebtShareState = IMultiChainDebtShareState(_debtShareState);
    }

    // View functions
    function multiChainDebtShareState() external view returns (address) {
        return address(_multiChainDebtShareState);
    }

    function getCurrentExternalDebtEntry() external view returns (uint debtShare, bool isDecreased) {
        (debtShare, isDecreased, ) = _multiChainDebtShareState.lastDebtShareStorageInfo();
    }

    // Mutative functions
    function setCurrentExternalDebtEntry(uint debtShare, bool isDecreased) external onlyOwner {
        _multiChainDebtShareState.appendToDebtShareStorage(debtShare, isDecreased);
    }

    function removeCurrentExternalDebtEntry() external onlyOwner {
        _multiChainDebtShareState.removeDebtShareStorage(_multiChainDebtShareState.lastDebtShareStorageIndex());
    }

    function setMultiChainDebtShareState(address multiChainDebtShareStateAddress) external onlyOwner {
        _multiChainDebtShareState = IMultiChainDebtShareState(multiChainDebtShareStateAddress);
    }
}
