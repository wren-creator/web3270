     * SALESRPT.RPGLE -- quarterly sales report run by the mock-as400
     * RPG interpreter (mock-lpar/rpg/interpreter.js). Fixed-form RPG
     * IV, V4R3-safe: no free-form C-specs. No arrays or file I/O in
     * this interpreter's v1 scope, so the four regions are an explicit
     * SELECT/WHEN lookup table over hardcoded scalars, not a real read
     * loop over a dataset -- a real, if array-substituted, RPG idiom.

     FSCREEN    CF   E             WORKSTN

     Dn1amt            S              9  2 INZ(125000.00)
     Dn2amt            S              9  2 INZ(98000.00)
     Dn3amt            S              9  2 INZ(143500.00)
     Dn4amt            S              9  2 INZ(76250.00)
     Didx              S              3  0 INZ(1)
     Dcnt              S              3  0 INZ(4)

     C                   EVAL      grandtot = 0
     C                   DOW       idx <= cnt
     C                   SELECT
     C                   WHEN      idx = 1
     C                   EVAL      regname = 'NORTH'
     C                   EVAL      regamt = n1amt
     C                   WHEN      idx = 2
     C                   EVAL      regname = 'SOUTH'
     C                   EVAL      regamt = n2amt
     C                   WHEN      idx = 3
     C                   EVAL      regname = 'EAST'
     C                   EVAL      regamt = n3amt
     C                   OTHER
     C                   EVAL      regname = 'WEST'
     C                   EVAL      regamt = n4amt
     C                   ENDSL
     C                   EVAL      grandtot = grandtot + regamt
     C                   EXFMT     DETAIL
     C                   IF        *in03 = *on
     C                   LEAVE
     C                   ENDIF
     C                   EVAL      idx = idx + 1
     C                   ENDDO
     C                   IF        *in03 = *off
     C                   EVAL      avgamt = grandtot / cnt
     C                   EXFMT     TOTAL
     C                   ENDIF
     C                   EVAL      *inlr = *on
     C                   RETURN
