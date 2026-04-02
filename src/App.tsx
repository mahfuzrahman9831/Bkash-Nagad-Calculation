/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo, Component } from 'react';
import { Plus, Trash2, Calendar, CreditCard, User, Calculator, History, Trash, LogIn, LogOut, AlertCircle } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { auth, db } from './firebase';
import { 
  signInWithPopup, 
  signInWithRedirect,
  GoogleAuthProvider, 
  onAuthStateChanged, 
  signOut,
  User as FirebaseUser 
} from 'firebase/auth';
import { 
  collection, 
  addDoc, 
  query, 
  where, 
  onSnapshot, 
  deleteDoc, 
  doc, 
  serverTimestamp, 
  Timestamp,
  orderBy
} from 'firebase/firestore';

// Utility for tailwind classes
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Error Handling Spec for Firestore Operations
enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

interface Transaction {
  id: string;
  date: string;
  amount: number;
  service: 'bKash' | 'Nagad';
  type: 'Personal' | 'Agent';
  commissionRate: number; // Rate per 1000
  uid: string;
  partnerId: string;
  createdAt: any;
}

interface Partner {
  id: string;
  name: string;
  uid: string;
  createdAt: any;
}

interface Payment {
  id: string;
  date: string;
  amount: number;
  uid: string;
  partnerId: string;
  createdAt: any;
}

const ConfirmationModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
}> = ({ isOpen, onClose, onConfirm, title, message }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-xl animate-in fade-in zoom-in duration-200">
        <h3 className="text-lg font-bold text-neutral-900 mb-2">{title}</h3>
        <p className="text-neutral-600 mb-6">{message}</p>
        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 rounded-lg border border-neutral-200 text-neutral-600 font-semibold hover:bg-neutral-50 transition-colors"
          >
            বাতিল
          </button>
          <button
            onClick={() => {
              onConfirm();
              onClose();
            }}
            className="flex-1 px-4 py-2 rounded-lg bg-red-600 text-white font-semibold hover:bg-red-700 transition-colors"
          >
            মুছে ফেলুন
          </button>
        </div>
      </div>
    </div>
  );
};

function MainApp() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [selectedPartnerId, setSelectedPartnerId] = useState<string>('');
  const [newPartnerName, setNewPartnerName] = useState('');
  const [isAddingPartner, setIsAddingPartner] = useState(false);
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {},
  });
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [formData, setFormData] = useState({
    date: format(new Date(), 'yyyy-MM-dd'),
    amount: '',
    service: 'bKash' as const,
    type: 'Personal' as const,
    commissionRate: '5',
  });
  const [paymentFormData, setPaymentFormData] = useState({
    date: format(new Date(), 'yyyy-MM-dd'),
    amount: '',
  });

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) {
      setPartners([]);
      setSelectedPartnerId('');
      return;
    }

    const q = query(
      collection(db, 'partners'),
      where('uid', '==', user.uid)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const pts = snapshot.docs.map(doc => ({
        ...doc.data(),
        id: doc.id,
      })) as Partner[];
      
      const sortedPartners = pts.sort((a, b) => {
        const timeA = a.createdAt?.toMillis ? a.createdAt.toMillis() : (a.createdAt?.seconds ? a.createdAt.seconds * 1000 : 0);
        const timeB = b.createdAt?.toMillis ? b.createdAt.toMillis() : (b.createdAt?.seconds ? b.createdAt.seconds * 1000 : 0);
        return timeA - timeB;
      });

      setPartners(sortedPartners);
      
      // If none is selected, select the first one
      if (sortedPartners.length > 0) {
        setSelectedPartnerId(prev => prev || sortedPartners[0].id);
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'partners');
    });

    return () => unsubscribe();
  }, [user]);

  useEffect(() => {
    if (!user || !selectedPartnerId) {
      setTransactions([]);
      return;
    }

    const q = query(
      collection(db, 'transactions'), 
      where('uid', '==', user.uid),
      where('partnerId', '==', selectedPartnerId)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const txs = snapshot.docs.map(doc => ({
        ...doc.data(),
        id: doc.id,
      })) as Transaction[];

      // Sort client-side: Absolute priority to entry time (createdAt)
      const sortedTxs = txs.sort((a, b) => {
        const timeA = a.createdAt?.toMillis ? a.createdAt.toMillis() : (a.createdAt?.seconds ? a.createdAt.seconds * 1000 : Date.now() + 10000);
        const timeB = b.createdAt?.toMillis ? b.createdAt.toMillis() : (b.createdAt?.seconds ? b.createdAt.seconds * 1000 : Date.now() + 10000);
        
        if (Math.abs(timeA - timeB) > 100) { // Significant difference in entry time
          return timeB - timeA;
        }
        
        // If entry time is almost identical, sort by date descending
        return b.date.localeCompare(a.date);
      });

      setTransactions(sortedTxs);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'transactions');
    });

    return () => unsubscribe();
  }, [user, selectedPartnerId]);

  useEffect(() => {
    if (!user || !selectedPartnerId) {
      setPayments([]);
      return;
    }

    const q = query(
      collection(db, 'payments'), 
      where('uid', '==', user.uid),
      where('partnerId', '==', selectedPartnerId)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const pms = snapshot.docs.map(doc => ({
        ...doc.data(),
        id: doc.id,
      })) as Payment[];

      const sortedPms = pms.sort((a, b) => {
        const timeA = a.createdAt?.toMillis ? a.createdAt.toMillis() : (a.createdAt?.seconds ? a.createdAt.seconds * 1000 : Date.now() + 10000);
        const timeB = b.createdAt?.toMillis ? b.createdAt.toMillis() : (b.createdAt?.seconds ? b.createdAt.seconds * 1000 : Date.now() + 10000);
        
        if (Math.abs(timeA - timeB) > 100) {
          return timeB - timeA;
        }
        return b.date.localeCompare(a.date);
      });

      setPayments(sortedPms);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'payments');
    });

    return () => unsubscribe();
  }, [user, selectedPartnerId]);

  const handleLogin = async (useRedirect = false) => {
    const provider = new GoogleAuthProvider();
    setLoginError(null);
    try {
      if (useRedirect) {
        await signInWithRedirect(auth, provider);
      } else {
        await signInWithPopup(auth, provider);
      }
    } catch (error: any) {
      console.error("Login failed", error);
      setLoginError(error.message || "লগইন করতে সমস্যা হয়েছে। আবার চেষ্টা করুন।");
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error("Logout failed", error);
    }
  };

  const handleAddTransaction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !selectedPartnerId || !formData.amount || !formData.commissionRate) return;

    const txData = {
      date: formData.date,
      amount: parseFloat(formData.amount),
      service: formData.service,
      type: formData.type,
      commissionRate: parseFloat(formData.commissionRate),
      uid: user.uid,
      partnerId: selectedPartnerId,
      createdAt: serverTimestamp(),
    };

    try {
      await addDoc(collection(db, 'transactions'), txData);
      setFormData({
        ...formData,
        amount: '',
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'transactions');
    }
  };

  const deleteTransaction = async (id: string) => {
    setConfirmModal({
      isOpen: true,
      title: 'লেনদেন মুছুন',
      message: 'আপনি কি এই লেনদেনটি মুছে ফেলতে চান?',
      onConfirm: async () => {
        try {
          await deleteDoc(doc(db, 'transactions', id));
        } catch (error) {
          handleFirestoreError(error, OperationType.DELETE, `transactions/${id}`);
        }
      },
    });
  };

  const handleAddPartner = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !newPartnerName.trim()) return;

    try {
      const partnerData = {
        name: newPartnerName.trim(),
        uid: user.uid,
        createdAt: serverTimestamp(),
      };
      const docRef = await addDoc(collection(db, 'partners'), partnerData);
      setNewPartnerName('');
      setIsAddingPartner(false);
      setSelectedPartnerId(docRef.id);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'partners');
    }
  };

  const deletePartner = async (id: string) => {
    setConfirmModal({
      isOpen: true,
      title: 'পার্টনার মুছুন',
      message: 'আপনি কি এই পার্টনার এবং তার সকল লেনদেন মুছে ফেলতে চান?',
      onConfirm: async () => {
        try {
          // Delete partner
          await deleteDoc(doc(db, 'partners', id));
          
          if (selectedPartnerId === id) {
            setSelectedPartnerId(partners.find(p => p.id !== id)?.id || '');
          }
        } catch (error) {
          handleFirestoreError(error, OperationType.DELETE, `partners/${id}`);
        }
      },
    });
  };

  const handleAddPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !selectedPartnerId || !paymentFormData.amount) return;

    const paymentData = {
      date: paymentFormData.date,
      amount: parseFloat(paymentFormData.amount),
      uid: user.uid,
      partnerId: selectedPartnerId,
      createdAt: serverTimestamp(),
    };

    try {
      await addDoc(collection(db, 'payments'), paymentData);
      setPaymentFormData({
        ...paymentFormData,
        amount: '',
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'payments');
    }
  };

  const deletePayment = async (id: string) => {
    setConfirmModal({
      isOpen: true,
      title: 'পেমেন্ট মুছুন',
      message: 'আপনি কি এই পেমেন্টটি মুছে ফেলতে চান?',
      onConfirm: async () => {
        try {
          await deleteDoc(doc(db, 'payments', id));
        } catch (error) {
          handleFirestoreError(error, OperationType.DELETE, `payments/${id}`);
        }
      },
    });
  };

  const groupedTransactions = useMemo(() => {
    const groups: Record<string, Transaction[]> = {};
    
    // Transactions are already sorted by entry time (latest first)
    transactions.forEach(t => {
      if (!groups[t.date]) {
        groups[t.date] = [];
      }
      groups[t.date].push(t);
    });
    
    // We want the groups themselves to be ordered by the LATEST entry within them
    const sortedDates = Object.keys(groups).sort((a, b) => {
      const latestA = groups[a][0].createdAt?.toMillis ? groups[a][0].createdAt.toMillis() : Date.now();
      const latestB = groups[b][0].createdAt?.toMillis ? groups[b][0].createdAt.toMillis() : Date.now();
      
      if (Math.abs(latestA - latestB) > 100) {
        return latestB - latestA;
      }
      return b.localeCompare(a);
    });

    const sortedGroups: Record<string, Transaction[]> = {};
    sortedDates.forEach(date => {
      sortedGroups[date] = groups[date];
    });
      
    return sortedGroups;
  }, [transactions]);

  const totals = useMemo(() => {
    const tTotals = transactions.reduce(
      (acc, t) => {
        const commission = (t.amount / 1000) * t.commissionRate;
        return {
          totalAmount: acc.totalAmount + t.amount,
          totalCommission: acc.totalCommission + commission,
        };
      },
      { totalAmount: 0, totalCommission: 0 }
    );

    const totalReceived = payments.reduce((acc, p) => acc + p.amount, 0);

    return {
      ...tTotals,
      totalReceived,
      balance: tTotals.totalAmount - totalReceived,
    };
  }, [transactions, payments]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-neutral-100">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-pink-600"></div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-neutral-100 p-4">
        <div className="bg-white p-8 rounded-2xl shadow-lg max-w-md w-full text-center space-y-6">
          <div className="bg-pink-50 w-20 h-20 rounded-full flex items-center justify-center mx-auto">
            <Calculator className="w-10 h-10 text-pink-600" />
          </div>
          <div className="space-y-2">
            <h1 className="text-2xl font-bold text-neutral-900">স্বাগতম!</h1>
            <p className="text-neutral-500">আপনার লেনদেনের হিসাব অনলাইনে সুরক্ষিত রাখতে লগইন করুন।</p>
          </div>
          
          {loginError && (
            <div className="space-y-3">
              <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm flex items-center gap-2">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{loginError}</span>
              </div>
              <p className="text-xs text-neutral-500">
                ফোন থেকে সমস্যা হলে এই লিঙ্কটি সরাসরি ব্রাউজারে ওপেন করুন: <br/>
                <a href="https://ais-pre-75hjggq6ffqklkeie5is5q-538284716822.asia-southeast1.run.app" target="_blank" rel="noopener noreferrer" className="text-pink-600 underline">Shared App Link</a>
              </p>
            </div>
          )}

          <div className="space-y-3">
            <button 
              onClick={() => handleLogin(false)}
              className="w-full bg-white border border-neutral-200 text-neutral-700 py-3 rounded-lg font-semibold flex items-center justify-center gap-3 hover:bg-neutral-50 transition-all shadow-sm"
            >
              <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" className="w-5 h-5" alt="Google" />
              গুগল দিয়ে লগইন করুন (পপআপ)
            </button>

            <button 
              onClick={() => handleLogin(true)}
              className="w-full bg-pink-600 text-white py-3 rounded-lg font-semibold flex items-center justify-center gap-3 hover:bg-pink-700 transition-all shadow-sm"
            >
              <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" className="w-5 h-5 brightness-200 invert" alt="Google" />
              মোবাইল দিয়ে লগইন করুন (সরাসরি)
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-100 text-neutral-900 font-sans p-4 md:p-8">
      <div className="max-w-4xl mx-auto space-y-8">
        {/* Header */}
        <header className="flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="bg-pink-600 p-2 rounded-lg">
              <Calculator className="w-6 h-6 text-white" />
            </div>
            <div className="text-left">
              <h1 className="text-xl font-bold text-neutral-900">বিকাশ ও নগদ কমিশন ক্যালকুলেটর</h1>
              <p className="text-xs text-neutral-500">{user.email}</p>
            </div>
          </div>
          <button 
            onClick={handleLogout}
            className="flex items-center gap-2 text-sm font-semibold text-neutral-500 hover:text-red-500 transition-colors"
          >
            <LogOut className="w-4 h-4" /> লগআউট
          </button>
        </header>

        <ConfirmationModal
          isOpen={confirmModal.isOpen}
          onClose={() => setConfirmModal({ ...confirmModal, isOpen: false })}
          onConfirm={confirmModal.onConfirm}
          title={confirmModal.title}
          message={confirmModal.message}
        />

        {/* Partner Selection */}
        <section className="bg-white rounded-2xl shadow-sm border border-neutral-200 p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold flex items-center gap-2">
              <User className="w-5 h-5 text-pink-600" /> পার্টনার নির্বাচন করুন
            </h2>
            <button 
              onClick={() => setIsAddingPartner(!isAddingPartner)}
              className="text-sm font-bold text-pink-600 hover:text-pink-700 flex items-center gap-1"
            >
              <Plus className="w-4 h-4" /> নতুন পার্টনার
            </button>
          </div>

          {isAddingPartner && (
            <form onSubmit={handleAddPartner} className="flex gap-2 animate-in fade-in slide-in-from-top-2">
              <input
                type="text"
                required
                placeholder="পার্টনারের নাম"
                value={newPartnerName}
                onChange={e => setNewPartnerName(e.target.value)}
                className="flex-1 px-4 py-2 rounded-lg border border-neutral-200 focus:ring-2 focus:ring-pink-500 outline-none"
              />
              <button
                type="submit"
                className="bg-pink-600 text-white px-4 py-2 rounded-lg font-bold hover:bg-pink-700 transition-colors"
              >
                যোগ করুন
              </button>
            </form>
          )}

          <div className="flex flex-wrap gap-2">
            {partners.length === 0 ? (
              <p className="text-sm text-neutral-400 italic">কোনো পার্টনার নেই। শুরু করতে নতুন পার্টনার যোগ করুন।</p>
            ) : (
              partners.map(p => (
                <div key={p.id} className="relative group">
                  <button
                    onClick={() => setSelectedPartnerId(p.id)}
                    className={cn(
                      "px-4 py-2 rounded-full text-sm font-bold transition-all border",
                      selectedPartnerId === p.id 
                        ? "bg-pink-600 border-pink-600 text-white shadow-md" 
                        : "bg-white border-neutral-200 text-neutral-600 hover:border-pink-300"
                    )}
                  >
                    {p.name}
                  </button>
                  <button 
                    onClick={() => deletePartner(p.id)}
                    className="absolute -top-1 -right-1 bg-white text-neutral-400 hover:text-red-500 rounded-full p-0.5 shadow-sm border border-neutral-100 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <Trash className="w-3 h-3" />
                  </button>
                </div>
              ))
            )}
          </div>
        </section>

        {/* Input Form */}
        {selectedPartnerId ? (
          <section className="bg-white rounded-2xl shadow-sm border border-neutral-200 p-6 animate-in fade-in slide-in-from-bottom-2">
            <div className="mb-4 pb-4 border-b border-neutral-100">
              <h3 className="font-bold text-neutral-700">
                লেনদেন যোগ করুন: <span className="text-pink-600">{partners.find(p => p.id === selectedPartnerId)?.name}</span>
              </h3>
            </div>
            <form onSubmit={handleAddTransaction} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="space-y-1">
              <label className="text-xs font-semibold uppercase tracking-wider text-neutral-500 flex items-center gap-1">
                <Calendar className="w-3 h-3" /> তারিখ
              </label>
              <input
                type="date"
                required
                value={formData.date}
                onChange={e => setFormData({ ...formData, date: e.target.value })}
                className="w-full px-4 py-2 rounded-lg border border-neutral-200 focus:ring-2 focus:ring-pink-500 focus:border-transparent outline-none transition-all"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold uppercase tracking-wider text-neutral-500 flex items-center gap-1">
                <CreditCard className="w-3 h-3" /> সার্ভিস
              </label>
              <select
                value={formData.service}
                onChange={e => setFormData({ ...formData, service: e.target.value as any })}
                className="w-full px-4 py-2 rounded-lg border border-neutral-200 focus:ring-2 focus:ring-pink-500 focus:border-transparent outline-none transition-all"
              >
                <option value="bKash">বিকাশ (bKash)</option>
                <option value="Nagad">নগদ (Nagad)</option>
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold uppercase tracking-wider text-neutral-500 flex items-center gap-1">
                <User className="w-3 h-3" /> টাইপ
              </label>
              <select
                value={formData.type}
                onChange={e => setFormData({ ...formData, type: e.target.value as any })}
                className="w-full px-4 py-2 rounded-lg border border-neutral-200 focus:ring-2 focus:ring-pink-500 focus:border-transparent outline-none transition-all"
              >
                <option value="Personal">পার্সোনাল (Personal)</option>
                <option value="Agent">এজেন্ট (Agent)</option>
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold uppercase tracking-wider text-neutral-500 flex items-center gap-1">
                টাকার পরিমাণ (Amount)
              </label>
              <input
                type="number"
                required
                placeholder="যেমন: ৫০০০"
                value={formData.amount}
                onChange={e => setFormData({ ...formData, amount: e.target.value })}
                className="w-full px-4 py-2 rounded-lg border border-neutral-200 focus:ring-2 focus:ring-pink-500 focus:border-transparent outline-none transition-all"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold uppercase tracking-wider text-neutral-500 flex items-center gap-1">
                কমিশন (প্রতি হাজারে কত টাকা)
              </label>
              <input
                type="number"
                step="0.1"
                required
                placeholder="যেমন: ৫"
                value={formData.commissionRate}
                onChange={e => setFormData({ ...formData, commissionRate: e.target.value })}
                className="w-full px-4 py-2 rounded-lg border border-neutral-200 focus:ring-2 focus:ring-pink-500 focus:border-transparent outline-none transition-all"
              />
            </div>

            <div className="flex items-end">
              <button
                type="submit"
                className="w-full bg-pink-600 hover:bg-pink-700 text-white font-bold py-2 px-4 rounded-lg transition-colors flex items-center justify-center gap-2 shadow-md"
              >
                <Plus className="w-5 h-5" /> যোগ করুন
              </button>
            </div>
          </form>

          <div className="mt-8 pt-8 border-t border-neutral-100">
            <h3 className="font-bold text-neutral-700 mb-4 flex items-center gap-2">
              <Plus className="w-5 h-5 text-green-600" /> জমা পাওয়া টাকা (Received Amount) যোগ করুন
            </h3>
            <form onSubmit={handleAddPayment} className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-1">
                <label className="text-xs font-semibold uppercase tracking-wider text-neutral-500 flex items-center gap-1">
                  <Calendar className="w-3 h-3" /> তারিখ
                </label>
                <input
                  type="date"
                  required
                  value={paymentFormData.date}
                  onChange={e => setPaymentFormData({ ...paymentFormData, date: e.target.value })}
                  className="w-full px-4 py-2 rounded-lg border border-neutral-200 focus:ring-2 focus:ring-pink-500 outline-none transition-all"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold uppercase tracking-wider text-neutral-500 flex items-center gap-1">
                  টাকার পরিমাণ
                </label>
                <input
                  type="number"
                  required
                  placeholder="যেমন: ৫০০০"
                  value={paymentFormData.amount}
                  onChange={e => setPaymentFormData({ ...paymentFormData, amount: e.target.value })}
                  className="w-full px-4 py-2 rounded-lg border border-neutral-200 focus:ring-2 focus:ring-pink-500 outline-none transition-all"
                />
              </div>
              <div className="flex items-end">
                <button
                  type="submit"
                  className="w-full bg-green-600 text-white py-2 rounded-lg font-bold hover:bg-green-700 transition-colors flex items-center justify-center gap-2 shadow-md"
                >
                  <Plus className="w-4 h-4" /> জমা যোগ করুন
                </button>
              </div>
            </form>
          </div>
        </section>
        ) : (
          <div className="bg-pink-50 p-8 rounded-2xl border border-pink-100 text-center space-y-2">
            <User className="w-12 h-12 text-pink-300 mx-auto" />
            <p className="text-pink-800 font-medium">লেনদেন যোগ করতে প্রথমে একজন পার্টনার নির্বাচন করুন।</p>
          </div>
        )}

        {/* Summary Cards */}
        <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-white p-8 rounded-2xl shadow-sm border border-neutral-200 flex items-center justify-between overflow-hidden min-h-[140px]">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold uppercase tracking-wider text-neutral-500 mb-1">মোট লেনদেন</p>
              <p className="text-2xl sm:text-3xl md:text-4xl font-bold text-neutral-900 break-words leading-tight">
                ৳ {totals.totalAmount.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
              </p>
            </div>
            <div className="bg-blue-50 p-5 rounded-full flex-shrink-0 ml-6">
              <CreditCard className="w-10 h-10 text-blue-600" />
            </div>
          </div>
          <div className="bg-white p-8 rounded-2xl shadow-sm border border-neutral-200 flex items-center justify-between overflow-hidden min-h-[140px]">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold uppercase tracking-wider text-neutral-500 mb-1">মোট কমিশন</p>
              <p className="text-2xl sm:text-3xl md:text-4xl font-bold text-pink-600 break-words leading-tight">
                ৳ {totals.totalCommission.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 3 })}
              </p>
            </div>
            <div className="bg-pink-50 p-5 rounded-full flex-shrink-0 ml-6">
              <Calculator className="w-10 h-10 text-pink-600" />
            </div>
          </div>
          <div className="bg-white p-8 rounded-2xl shadow-sm border border-neutral-200 flex items-center justify-between overflow-hidden min-h-[140px]">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold uppercase tracking-wider text-neutral-500 mb-1">জমা পাওয়া গেছে</p>
              <p className="text-2xl sm:text-3xl md:text-4xl font-bold text-green-600 break-words leading-tight">
                ৳ {totals.totalReceived.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
              </p>
            </div>
            <div className="bg-green-50 p-5 rounded-full flex-shrink-0 ml-6">
              <Plus className="w-10 h-10 text-green-600" />
            </div>
          </div>
          <div className="bg-white p-8 rounded-2xl shadow-sm border border-neutral-200 flex items-center justify-between overflow-hidden min-h-[140px]">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold uppercase tracking-wider text-neutral-500 mb-1">বাকি (Balance)</p>
              <p className={cn(
                "text-2xl sm:text-3xl md:text-4xl font-bold break-words leading-tight",
                totals.balance > 0 ? "text-red-600" : "text-blue-600"
              )}>
                ৳ {totals.balance.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 3 })}
              </p>
            </div>
            <div className={cn(
              "p-5 rounded-full flex-shrink-0 ml-6",
              totals.balance > 0 ? "bg-red-50" : "bg-blue-50"
            )}>
              <History className={cn(
                "w-10 h-10",
                totals.balance > 0 ? "text-red-600" : "text-blue-600"
              )} />
            </div>
          </div>
        </section>

        {/* Histories */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Transaction History */}
          <section className="lg:col-span-2 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold flex items-center gap-2">
                <History className="w-5 h-5" /> লেনদেনের ইতিহাস
              </h2>
            </div>

            {Object.keys(groupedTransactions).length === 0 ? (
              <div className="bg-white p-12 rounded-2xl border border-dashed border-neutral-300 text-center space-y-2">
                <p className="text-neutral-400">এখনো কোনো লেনদেন যোগ করা হয়নি।</p>
              </div>
            ) : (
              <div className="space-y-6">
                {Object.entries(groupedTransactions).map(([date, items]) => (
                  <div key={date} className="space-y-2">
                    <div className="flex items-center gap-2 px-2">
                      <span className="text-sm font-bold text-neutral-500 bg-neutral-200 px-2 py-0.5 rounded">
                        {format(parseISO(date), 'dd MMMM, yyyy')}
                      </span>
                      <div className="h-px flex-1 bg-neutral-200"></div>
                    </div>
                    <div className="bg-white rounded-2xl shadow-sm border border-neutral-200 overflow-hidden">
                      <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse min-w-[600px]">
                          <thead>
                            <tr className="bg-neutral-50 border-b border-neutral-200">
                              <th className="px-4 py-3 text-xs font-semibold uppercase text-neutral-500">সার্ভিস</th>
                              <th className="px-4 py-3 text-xs font-semibold uppercase text-neutral-500">টাইপ</th>
                              <th className="px-4 py-3 text-xs font-semibold uppercase text-neutral-500">পরিমাণ</th>
                              <th className="px-4 py-3 text-xs font-semibold uppercase text-neutral-500">হার (১০০০)</th>
                              <th className="px-4 py-3 text-xs font-semibold uppercase text-neutral-500">কমিশন</th>
                              <th className="px-4 py-3 text-xs font-semibold uppercase text-neutral-500 text-right">অ্যাকশন</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-neutral-100">
                            {(items as Transaction[]).map(t => {
                              const commission = (t.amount / 1000) * t.commissionRate;
                              return (
                                <tr key={t.id} className="hover:bg-neutral-50 transition-colors">
                                  <td className="px-4 py-3">
                                    <span className={cn(
                                      "text-xs font-bold px-2 py-1 rounded",
                                      t.service === 'bKash' ? "bg-pink-100 text-pink-700" : "bg-orange-100 text-orange-700"
                                    )}>
                                      {t.service}
                                    </span>
                                  </td>
                                  <td className="px-4 py-3 text-sm text-neutral-600">{t.type}</td>
                                  <td className="px-4 py-3 text-sm font-bold">৳ {t.amount.toLocaleString()}</td>
                                  <td className="px-4 py-3 text-sm text-neutral-500">{t.commissionRate}</td>
                                  <td className="px-4 py-3 text-sm font-bold text-pink-600">৳ {commission.toLocaleString()}</td>
                                  <td className="px-4 py-3 text-right">
                                    <button
                                      onClick={() => deleteTransaction(t.id)}
                                      className="p-1 text-neutral-400 hover:text-red-500 transition-colors"
                                    >
                                      <Trash2 className="w-4 h-4" />
                                    </button>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Payment History */}
          <section className="space-y-4">
            <h2 className="text-xl font-bold flex items-center gap-2">
              <Plus className="w-5 h-5 text-green-600" /> জমার ইতিহাস
            </h2>
            <div className="bg-white rounded-2xl shadow-sm border border-neutral-200 overflow-hidden">
              {payments.length === 0 ? (
                <div className="p-8 text-center text-neutral-400 italic text-sm">
                  কোনো জমা রেকর্ড করা হয়নি।
                </div>
              ) : (
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-neutral-50 border-b border-neutral-200">
                      <th className="px-4 py-3 text-xs font-semibold uppercase text-neutral-500">তারিখ</th>
                      <th className="px-4 py-3 text-xs font-semibold uppercase text-neutral-500">পরিমাণ</th>
                      <th className="px-4 py-3 text-xs font-semibold uppercase text-neutral-500 text-right"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100">
                    {payments.map(p => (
                      <tr key={p.id} className="hover:bg-neutral-50 transition-colors">
                        <td className="px-4 py-3 text-sm text-neutral-600">
                          {format(parseISO(p.date), 'dd MMM, yy')}
                        </td>
                        <td className="px-4 py-3 text-sm font-bold text-green-600">
                          ৳ {p.amount.toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={() => deletePayment(p.id)}
                            className="p-1 text-neutral-400 hover:text-red-500 transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

// Error Boundary Component
class ErrorBoundary extends (React.Component as any) {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      let errorMessage = "কিছু একটা ভুল হয়েছে।";
      try {
        const parsed = JSON.parse(this.state.error.message);
        if (parsed.error) errorMessage = `ফায়ারবেস ত্রুটি: ${parsed.error}`;
      } catch (e) {
        errorMessage = this.state.error.message || errorMessage;
      }

      return (
        <div className="min-h-screen flex items-center justify-center bg-neutral-100 p-4">
          <div className="bg-white p-8 rounded-2xl shadow-lg max-w-md w-full text-center space-y-4">
            <AlertCircle className="w-16 h-16 text-red-500 mx-auto" />
            <h2 className="text-2xl font-bold text-neutral-900">ত্রুটি!</h2>
            <p className="text-neutral-600">{errorMessage}</p>
            <button 
              onClick={() => window.location.reload()}
              className="w-full bg-pink-600 text-white py-2 rounded-lg font-bold hover:bg-pink-700 transition-colors"
            >
              আবার চেষ্টা করুন
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  return (
    <ErrorBoundary>
      <MainApp />
    </ErrorBoundary>
  );
}
