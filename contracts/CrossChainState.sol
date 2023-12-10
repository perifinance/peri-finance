pragma solidity 0.5.16;

// Inheritance
import "./Owned.sol";
import "./State.sol";
import "./interfaces/ICrossChainState.sol";

// libraries
import "./Math.sol";

/**
 * @title CrossChainState
 * @author @Enitsed
 * @notice This contract saves data of All the networks staking system debt
 */
contract CrossChainState is Owned, State, ICrossChainState {
    using SafeMath for uint;

    uint private _selfId;
    uint[] private _networkIds;
    // current network's inbound amount compiled by other networks
    uint public outboundSumToCurrentNetwork;

    mapping(uint => uint) private _crossNetworkIssuedDebt;
    mapping(uint => uint) private _crossNetworkActiveDebt;

    // the total network debt and current network debt percentage
    // uint[] internal _totalNetworkDebtLedger;
    // mapping(address => CrossNetworkUserData) private _crossNetworkUserData;

    constructor(
        address _owner,
        address _associatedContract,
        uint _chainId
    ) public Owned(_owner) State(_associatedContract) {
        _selfId = _chainId;
        _networkIds.push(_chainId);
    }

    // View functions

    function getChainID() external view returns (uint) {
        return _selfId;
    }

    function crossChainCount() external view returns (uint) {
        return _networkIds.length;
    }

    /**
     * @notice returns current network's issued debt
     * @return uint
     */
    function currentNetworkIssuedDebt() external view returns (uint) {
        return _crossNetworkIssuedDebt[_selfId];
    }

    /**
     * @notice returns total network's issued debt
     * @return uint
     */
    function totalNetworkIssuedDebt() external view returns (uint) {
        uint result = 0;
        for (uint i = 0; i < _networkIds.length; ++i) {
            result += (_crossNetworkIssuedDebt[_networkIds[i]]);
        }
        return result;
    }

    function crossNetworkIssuedDebtAll() external view returns (uint) {
        uint result = 0;
        for (uint i = 0; i < _networkIds.length; ++i) {
            if (_networkIds[i] == _selfId) continue;
            result += (_crossNetworkIssuedDebt[_networkIds[i]]);
        }
        return result;
    }

    function crossNetworkActiveDebtAll() external view returns (uint) {
        uint result = 0;
        for (uint i = 0; i < _networkIds.length; ++i) {
            if (_networkIds[i] == _selfId) continue;
            result = result.add(_crossNetworkActiveDebt[_networkIds[i]]);
        }
        return result;
    }

    //************************ Mutative functions *****************************//
    /**
     * @notice add a cross chain network id
     * @param _networkId id of the cross chain network
     */
    function addNetworkId(uint _networkId) external onlyAssociatedContract {
        for (uint i = 0; i < _networkIds.length; ++i) {
            if (_networkIds[i] == _networkId) {
                return;
            }
        }
        _networkIds.push(_networkId);
    }

    /**
     * @notice add cross chain networks' issued debts
     * @param _chainIDs uint[]
     */
    function setCrossNetworkIssuedDebtAll(uint[] calldata _chainIDs, uint[] calldata _amounts)
        external
        onlyAssociatedContract
    {
        for (uint i = 0; i < _chainIDs.length; ++i) {
            if (_chainIDs[i] != _selfId) {
                _crossNetworkIssuedDebt[_chainIDs[i]] = _amounts[i];
            }
        }
    }

    /**
     * @notice add cross chain networks' active debts
     * @param _chainIDs uint[]
     * @param _amounts uint[] debt amounts
     */
    function setCrossNetworkActiveDebtAll(uint[] calldata _chainIDs, uint[] calldata _amounts)
        external
        onlyAssociatedContract
    {
        for (uint i = 0; i < _chainIDs.length; ++i) {
            if (_chainIDs[i] != _selfId) {
                _crossNetworkActiveDebt[_chainIDs[i]] = _amounts[i];
            }
        }
    }

    /**
     * @notice add all cross chain networks' debts
     * @param _chainIDs uint
     * @param _debts uint
     * @param _activeDebts uint
     * @param _inbound uint sum of other networks' outbound bridged amount to the current network
     */
    function setCrossNetworkDebtsAll(
        uint[] calldata _chainIDs,
        uint[] calldata _debts,
        uint[] calldata _activeDebts,
        uint _inbound
    ) external onlyAssociatedContract {
        for (uint i = 0; i < _chainIDs.length; ++i) {
            if (_chainIDs[i] != _selfId) {
                _crossNetworkIssuedDebt[_chainIDs[i]] = _debts[i];
                _crossNetworkActiveDebt[_chainIDs[i]] = _activeDebts[i];
            }
        }
        outboundSumToCurrentNetwork = _inbound;
    }

    /**
     * @notice add a cross chain network's both issued and active debts
     * @dev add a new network id and the debt
     * @param _chainID uint
     * @param _issuedDebt uint
     * @param _activeDebt uint
     */
    function addCrossNetworkNDebts(
        uint _chainID,
        uint _issuedDebt,
        uint _activeDebt
    ) external onlyAssociatedContract {
        for (uint i = 0; i < _networkIds.length; ++i) {
            if (_networkIds[i] == _chainID) {
                revert("network id already exists");
            }
        }

        _networkIds.push(_chainID);
        _crossNetworkIssuedDebt[_chainID] = _issuedDebt;
        _crossNetworkActiveDebt[_chainID] = _activeDebt;
    }

    /**
     * @notice add current network's issued debt
     * @param _amount uint
     */
    function addIssuedDebt(uint _chainID, uint _amount) external onlyAssociatedContract {
        if (_crossNetworkIssuedDebt[_chainID] == 0) {
            _crossNetworkIssuedDebt[_chainID] = _amount;
        } else {
            _crossNetworkIssuedDebt[_chainID] += _amount;
        }
    }

    /**
     * @notice subtract current network's issued debt
     * @param _amount uint
     */
    function subtractIssuedDebt(uint _chainID, uint _amount) external onlyAssociatedContract {
        if (_crossNetworkIssuedDebt[_chainID] < _amount) {
            _crossNetworkIssuedDebt[_chainID] = 0;
        }
        _crossNetworkIssuedDebt[_chainID] -= _amount;
    }

    /**
     * @notice sum of other networks' outbound bridged amount to the current network
     * @param _amount uint
     */
    function setOutboundSumToCurrentNetwork(uint _amount) external onlyAssociatedContract {
        outboundSumToCurrentNetwork = _amount;
    }

    /**
     * @notice initial current network's issued debt only for the first time,
     *          supposed that it hasn't been bridged to any network
     * @param _amount uint
     */
    function setInitialCurrentIssuedDebt(uint _amount) external onlyAssociatedContract {
        // only initial possible
        if (_crossNetworkIssuedDebt[_selfId] == 0) {
            _crossNetworkIssuedDebt[_selfId] = _amount;
        }
    }

    // Events

    // /**
    //  * @notice Emitted when totalNetworkDebt has added
    //  * @param totalNetworkDebt uint
    //  * @param timestamp uint
    //  */
    // event TotalNetworkDebtAdded(uint totalNetworkDebt, uint timestamp);

    // /**
    //  * @notice Emitted when user cross network data updated
    //  * @param account address
    //  * @param userStateDebtLedgerIndex uint
    //  * @param timestamp uint
    //  */
    // event UserCrossNetworkDataUpdated(address account, uint userStateDebtLedgerIndex, uint timestamp);

    // /**
    //  * @notice Emitted when user cross network data deleted
    //  * @param account address
    //  * @param timestamp uint
    //  */
    // event UserCrossNetworkDataRemoved(address account, uint timestamp);

    // deprecated functions --> to be removed. they do nothing inside the contract

    // /**
    //  * @notice returns the length of total network debt entry
    //  * @return uint
    //  */
    // function totalNetworkDebtLedgerLength() external view returns (uint) {
    //     return _totalNetworkDebtLedger.length;
    // }

    // /**
    //  * @notice returns the latest total network debt
    //  * @return uint
    //  */
    // function lastTotalNetworkDebtLedgerEntry() external view returns (uint) {
    //     return _lastTotalNetworkDebtEntry();
    // }

    // /**
    //  * @notice returns the total network debt amount at index
    //  * @param index uint
    //  * @return uint
    //  */
    // function getTotalNetworkDebtEntryAtIndex(uint index) external view returns (uint) {
    //     return _getTotalNetworkDebtEntryAtIndex(index);
    // }

    // function getCrossNetworkUserData(address account)
    //     external
    //     view
    //     returns (uint crossChainDebtEntryIndex, uint userStateDebtLedgerIndex)
    // {
    //     crossChainDebtEntryIndex = _crossNetworkUserData[account].totalNetworkDebtLedgerIndex;
    //     userStateDebtLedgerIndex = _crossNetworkUserData[account].userStateDebtLedgerIndex;
    // }

    // function getCrossChainIds() external view returns (bytes32[] memory) {
    //     return crossChainIds;
    // }

    // // Internal View functions
    // function _getTotalNetworkDebtEntryAtIndex(uint index) internal view returns (uint) {
    //     return _totalNetworkDebtLedger[index];
    // }

    // function _lastTotalNetworkDebtEntry() internal view returns (uint) {
    //     if (_totalNetworkDebtLedger.length == 0) {
    //         return 0;
    //     }

    //     return _totalNetworkDebtLedger[_totalNetworkDebtLedger.length - 1];
    // }

    // // Mutative functions

    // /**
    //  * @notice set total network status when user's debt ownership is changed
    //  * @param from address
    //  * @param userStateDebtLedgerIndex uint
    //  */
    // function setCrossNetworkUserData(address from, uint userStateDebtLedgerIndex) external onlyAssociatedContract {
    //     _crossNetworkUserData[from] = CrossNetworkUserData(_totalNetworkDebtLedger.length - 1, userStateDebtLedgerIndex);

    //     emit UserCrossNetworkDataUpdated(from, userStateDebtLedgerIndex, block.timestamp);
    // }

    // /**
    //  * @notice clear the user's total network debt info
    //  * @param from address
    //  */
    // function clearCrossNetworkUserData(address from) external onlyAssociatedContract {
    //     delete _crossNetworkUserData[from];

    //     emit UserCrossNetworkDataRemoved(from, block.timestamp);
    // }

    // function appendTotalNetworkDebtLedger(uint totalNetworkDebt) external onlyAssociatedContract {
    //     _totalNetworkDebtLedger.push(totalNetworkDebt);

    //     emit TotalNetworkDebtAdded(totalNetworkDebt, block.timestamp);
    // }

    // function addTotalNetworkDebtLedger(uint amount) external onlyAssociatedContract {
    //     if (_totalNetworkDebtLedger.length == 0) {
    //         _totalNetworkDebtLedger.push(amount);
    //         emit TotalNetworkDebtAdded(amount, block.timestamp);
    //     } else {
    //         _totalNetworkDebtLedger[_totalNetworkDebtLedger.length - 1] = _lastTotalNetworkDebtEntry().add(amount);
    //     }
    // }

    // function subtractTotalNetworkDebtLedger(uint amount) external onlyAssociatedContract {
    //     require(_totalNetworkDebtLedger.length > 0, "total network debt should be appended first");

    //     _totalNetworkDebtLedger[_totalNetworkDebtLedger.length - 1] = _lastTotalNetworkDebtEntry().sub(amount);
    // }

    // function setCrosschain(bytes32 _chainID) external onlyAssociatedContract {
    //     chainId = _chainID;
    //     for (uint i = 0; i < crossChainIds.length; ++i) {
    //         if (crossChainIds[i] == _chainID) {
    //             break;
    //         }
    //     }
    //     crossChainIds.push(_chainID);
    // }

    // function addCrosschain(bytes32 _chainID) external onlyAssociatedContract {
    //     for (uint i = 0; i < crossChainIds.length; ++i) {
    //         if (crossChainIds[i] == _chainID) {
    //             break;
    //         }
    //     }
    //     crossChainIds.push(_chainID);
    // }
}
