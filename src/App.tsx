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

function MainApp() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [selectedPartnerId, setSelectedPartnerId] = useState<string>('');
  const [newPartnerName, setNewPartnerName] = useState('');
  const [isAddingPartner, setIsAddingPartner] = useState(false);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [formData, setFormData] = useState({
    date: format(new Date(), 'yyyy-MM-dd'),
    amount: '',
    service: 'bKash' as const,
    type: 'Personal' as const,
    commissionRate: '5',
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

      // Sort client-side: Primary by date (desc), secondary by createdAt (desc)
      const sortedTxs = txs.sort((a, b) => {
        if (a.date !== b.date) {
          return b.date.localeCompare(a.date);
        }
        // Handle serverTimestamp which might be null in local snapshot
        const timeA = a.createdAt?.toMillis ? a.createdAt.toMillis() : (a.createdAt?.seconds ? a.createdAt.seconds * 1000 : Date.now());
        const timeB = b.createdAt?.toMillis ? b.createdAt.toMillis() : (b.createdAt?.seconds ? b.createdAt.seconds * 1000 : Date.now());
        return timeB - timeA;
      });

      setTransactions(sortedTxs);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'transactions');
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
    if (confirm('আপনি কি এই লেনদেনটি মুছে ফেলতে চান?')) {
      try {
        await deleteDoc(doc(db, 'transactions', id));
      } catch (error) {
        handleFirestoreError(error, OperationType.DELETE, `transactions/${id}`);
      }
    }
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
    if (confirm('আপনি কি এই পার্টনার এবং তার সকল লেনদেন মুছে ফেলতে চান?')) {
      try {
        // Delete partner
        await deleteDoc(doc(db, 'partners', id));
        
        // Note: In a real app, you'd also delete all transactions for this partner.
        // For simplicity here, we just delete the partner. 
        // Firestore rules will prevent orphaned transactions from being read if filtered by partnerId.
        
        if (selectedPartnerId === id) {
          setSelectedPartnerId(partners.find(p => p.id !== id)?.id || '');
        }
      } catch (error) {
        handleFirestoreError(error, OperationType.DELETE, `partners/${id}`);
      }
    }
  };

  const groupedTransactions = useMemo(() => {
    const groups: Record<string, Transaction[]> = {};
    transactions.forEach(t => {
      if (!groups[t.date]) {
        groups[t.date] = [];
      }
      groups[t.date].push(t);
    });
    return groups;
  }, [transactions]);

  const totals = useMemo(() => {
    return transactions.reduce(
      (acc, t) => {
        const commission = (t.amount / 1000) * t.commissionRate;
        return {
          totalAmount: acc.totalAmount + t.amount,
          totalCommission: acc.totalCommission + commission,
        };
      },
      { totalAmount: 0, totalCommission: 0 }
    );
  }, [transactions]);

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
        </section>
        ) : (
          <div className="bg-pink-50 p-8 rounded-2xl border border-pink-100 text-center space-y-2">
            <User className="w-12 h-12 text-pink-300 mx-auto" />
            <p className="text-pink-800 font-medium">লেনদেন যোগ করতে প্রথমে একজন পার্টনার নির্বাচন করুন।</p>
          </div>
        )}

        {/* Summary Cards */}
        <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-neutral-200 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500">মোট লেনদেন</p>
              <p className="text-2xl font-bold text-neutral-900">৳ {totals.totalAmount.toLocaleString()}</p>
            </div>
            <div className="bg-blue-50 p-3 rounded-full">
              <CreditCard className="w-6 h-6 text-blue-600" />
            </div>
          </div>
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-neutral-200 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500">মোট কমিশন</p>
              <p className="text-2xl font-bold text-pink-600">৳ {totals.totalCommission.toLocaleString()}</p>
            </div>
            <div className="bg-pink-50 p-3 rounded-full">
              <Calculator className="w-6 h-6 text-pink-600" />
            </div>
          </div>
        </section>

        {/* Transaction History */}
        <section className="space-y-4">
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
