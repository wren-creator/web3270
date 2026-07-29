     * ADVENTURE.RPGLE -- text-adventure game run by the mock-as400
     * RPG interpreter (mock-lpar/rpg/interpreter.js). Fixed-form
     * RPG IV, V4R3-safe: no free-form C-specs (those need V5R1+).
     * Random rolls use classic DIV/MVR for modulo (no %REM until
     * well past V4R3) -- see ROLLRNG.

     FSCREEN    CF   E             WORKSTN

     Dseed             S              6  0 INZ(17)
     Dloc              S              1  0 INZ(1)
     Droll             S              6  0
     Ddmg              S              3  0
     Dquot             S              6  0
     Dkillcnt          S              3  0 INZ(0)

     C                   EVAL      plrhp = 20
     C                   EVAL      *in90 = *off
     C                   DOW       *in03 = *off
     C                   EXSR      BUILDLOC
     C                   EXFMT     MAIN
     C                   IF        *in03 = *on
     C                   LEAVE
     C                   ENDIF
     C                   SELECT
     C                   WHEN      cmd = 'M'
     C                   EXSR      DOMOVE
     C                   OTHER
     C                   EVAL      msgtxt = 'Unknown command. Try M.'
     C                   EVAL      *in90 = *on
     C                   ENDSL
     C                   ENDDO
     C                   EVAL      *inlr = *on
     C                   RETURN

     C     BUILDLOC      BEGSR
     C                   SELECT
     C                   WHEN      loc = 1
     C                   EVAL      loctxt = 'a dark forest'
     C                   WHEN      loc = 2
     C                   EVAL      loctxt = 'a damp cave'
     C                   OTHER
     C                   EVAL      loctxt = 'a quiet village'
     C                   ENDSL
     C                   ENDSR

     C     DOMOVE        BEGSR
     C                   IF        loc = 1
     C                   EVAL      loc = 2
     C                   ELSE
     C                   IF        loc = 2
     C                   EVAL      loc = 3
     C                   ELSE
     C                   EVAL      loc = 1
     C                   ENDIF
     C                   ENDIF
     C                   EVAL      msgtxt = 'You move on.'
     C                   EVAL      *in90 = *on
     C                   EXSR      ROLLRNG
     C     seed          DIV       100           quot
     C                   MVR                     roll
     C                   IF        roll < 50
     C                   EXSR      ENCOUNTER
     C                   ENDIF
     C                   ENDSR

     C     ROLLRNG       BEGSR
     C                   EVAL      seed = seed * 31 + 7
     C     seed          DIV       9973          quot
     C                   MVR                     seed
     C                   ENDSR

     C     ENCOUNTER     BEGSR
     C                   EVAL      monnam = 'a goblin'
     C                   EVAL      monhp = 12
     C                   EVAL      *in80 = *off
     C                   DOW       monhp > 0 and plrhp > 0
     C                   EXFMT     COMBAT
     C                   IF        *in03 = *on
     C                   LEAVE
     C                   ENDIF
     C                   SELECT
     C                   WHEN      cmd = 'F'
     C                   EXSR      FIGHTRND
     C                   WHEN      cmd = 'R'
     C                   EXSR      RUNRND
     C                   OTHER
     C                   EVAL      msgtxt = 'Fight (F) or Run (R)?'
     C                   EVAL      *in90 = *on
     C                   ENDSL
     C                   IF        *in80 = *on
     C                   LEAVE
     C                   ENDIF
     C                   ENDDO
     C                   IF        *in03 = *on
     C                   RETURN
     C                   ENDIF
     C                   IF        plrhp <= 0
     C                   EVAL      msgtxt = 'The goblin has defeated you...'
     C                   EXFMT     ENDGAME
     C                   EVAL      *inlr = *on
     C                   RETURN
     C                   ELSE
     C                   IF        *in80 = *on
     C                   EVAL      msgtxt = 'You got away.'
     C                   EVAL      *in90 = *on
     C                   ELSE
     C                   EVAL      killcnt = killcnt + 1
     C                   IF        killcnt >= 3
     C                   EVAL      msgtxt = 'The last goblin falls. YOU WIN!'
     C                   EXFMT     ENDGAME
     C                   EVAL      *inlr = *on
     C                   RETURN
     C                   ELSE
     C                   EVAL      msgtxt = 'You defeated the goblin!'
     C                   EVAL      *in90 = *on
     C                   ENDIF
     C                   ENDIF
     C                   ENDIF
     C                   ENDSR

     C     FIGHTRND      BEGSR
     C                   EXSR      ROLLRNG
     C     seed          DIV       6             quot
     C                   MVR                     dmg
     C                   EVAL      dmg = dmg + 2
     C                   EVAL      monhp = monhp - dmg
     C                   IF        monhp > 0
     C                   EXSR      ROLLRNG
     C     seed          DIV       5             quot
     C                   MVR                     roll
     C                   EVAL      roll = roll + 1
     C                   EVAL      plrhp = plrhp - roll
     C                   EVAL      msgtxt = 'You hit it! It hits back.'
     C                   ELSE
     C                   EVAL      msgtxt = 'Finishing blow!'
     C                   ENDIF
     C                   EVAL      *in90 = *on
     C                   ENDSR

     C     RUNRND        BEGSR
     C                   EXSR      ROLLRNG
     C     seed          DIV       100           quot
     C                   MVR                     roll
     C                   IF        roll < 50
     C                   EVAL      *in80 = *on
     C                   ELSE
     C                   EXSR      ROLLRNG
     C     seed          DIV       4             quot
     C                   MVR                     dmg
     C                   EVAL      dmg = dmg + 1
     C                   EVAL      plrhp = plrhp - dmg
     C                   EVAL      msgtxt = 'You fail to escape! It hits you.'
     C                   EVAL      *in90 = *on
     C                   ENDIF
     C                   ENDSR
